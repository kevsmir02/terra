mod common;

use common::{git_available, FsFixture, GitRepoFixture};
use terra_lib::modules::fs::grep::{glob_files, grep};
use terra_lib::modules::fs::search::search;
use terra_lib::modules::fs::tree::{read_dir, subdirs, EntryKind};

#[test]
fn grep_finds_matches_and_returns_relative_paths() {
    let fx = FsFixture::new();
    fx.write("src/main.rs", "fn main() {\n    println!(\"hello world\");\n}\n");
    fx.write("src/lib.rs", "pub fn greet() {}\n");

    let res = grep(&fx.registry, "hello",
        &fx.root_str(),
        None,
        None,
        None)
    .expect("grep");

    assert_eq!(res.hits.len(), 1);
    let hit = &res.hits[0];
    assert_eq!(hit.rel, "src/main.rs");
    assert_eq!(hit.line, 2);
    assert!(hit.text.contains("hello world"));
    assert!(!res.truncated);
    assert_eq!(res.files_scanned, 2);
}

#[test]
fn grep_case_insensitive_finds_mixed_case() {
    let fx = FsFixture::new();
    fx.write("a.txt", "Hello World\n");

    let strict = grep(&fx.registry, "hello", &fx.root_str(), None, Some(false), None)
        .expect("grep");
    assert!(strict.hits.is_empty());

    let loose = grep(&fx.registry, "hello", &fx.root_str(), None, Some(true), None)
        .expect("grep");
    assert_eq!(loose.hits.len(), 1);
}

#[test]
fn grep_glob_filter_restricts_files() {
    let fx = FsFixture::new();
    fx.write("a.rs", "target\n");
    fx.write("b.ts", "target\n");

    let res = grep(&fx.registry, "target",
        &fx.root_str(),
        Some(vec!["*.rs".into()]),
        None,
        None)
    .expect("grep");

    assert_eq!(res.hits.len(), 1);
    assert_eq!(res.hits[0].rel, "a.rs");
}

#[test]
fn grep_max_results_truncates() {
    let fx = FsFixture::new();
    for i in 0..10 {
        fx.write(&format!("f{i}.txt"), "needle\n");
    }

    let res = grep(&fx.registry, "needle", &fx.root_str(), None, None, Some(3))
        .expect("grep");

    assert!(res.hits.len() <= 3);
    assert!(res.truncated);
}

#[test]
fn grep_empty_pattern_errors() {
    let fx = FsFixture::new();
    let err = grep(&fx.registry, "", &fx.root_str(), None, None, None);
    assert!(err.is_err());
}

#[test]
fn grep_non_dir_root_errors() {
    let fx = FsFixture::new();
    let err = grep(&fx.registry, "x",
        &fx.root_str_join("this/does/not/exist"),
        None,
        None,
        None);
    assert!(err.is_err());
}

#[test]
fn grep_respects_ignore_file() {
    let fx = FsFixture::new();
    fx.write(".ignore", "ignored.txt\n");
    fx.write("ignored.txt", "secret\n");
    fx.write("visible.txt", "secret\n");

    let res = grep(&fx.registry, "secret", &fx.root_str(), None, None, None)
        .expect("grep");

    let rels: Vec<&str> = res.hits.iter().map(|h| h.rel.as_str()).collect();
    assert!(rels.contains(&"visible.txt"));
    assert!(!rels.contains(&"ignored.txt"));
}

#[test]
fn glob_finds_files_by_pattern() {
    let fx = FsFixture::new();
    fx.write("src/a.rs", "");
    fx.write("src/b.rs", "");
    fx.write("README.md", "");

    let res = glob_files(&fx.registry, "**/*.rs", &fx.root_str(), None).expect("glob");

    let mut rels: Vec<&str> = res.hits.iter().map(|h| h.rel.as_str()).collect();
    rels.sort();
    assert_eq!(rels, vec!["src/a.rs", "src/b.rs"]);
}

#[test]
fn glob_truncates_on_limit() {
    let fx = FsFixture::new();
    for i in 0..20 {
        fx.write(&format!("file{i}.txt"), "");
    }

    let res = glob_files(&fx.registry, "*.txt", &fx.root_str(), Some(5)).expect("glob");
    assert!(res.hits.len() <= 5);
    assert!(res.truncated);
}

#[test]
fn glob_empty_pattern_errors() {
    let fx = FsFixture::new();
    assert!(glob_files(&fx.registry, "", &fx.root_str(), None).is_err());
}

#[test]
fn search_substring_matches_filename() {
    let fx = FsFixture::new();
    fx.write("src/main.rs", "");
    fx.write("src/lib.rs", "");
    fx.write("docs/main.md", "");

    let res = search(&fx.registry, &fx.root_str(), "main", None, None).expect("search");
    let rels: Vec<&str> = res.hits.iter().map(|h| h.rel.as_str()).collect();
    assert!(rels.contains(&"src/main.rs"));
    assert!(rels.contains(&"docs/main.md"));
    assert!(!rels.contains(&"src/lib.rs"));
}

#[test]
fn search_is_case_insensitive() {
    let fx = FsFixture::new();
    fx.write("README.md", "");
    let res = search(&fx.registry, &fx.root_str(), "readme", None, None).expect("search");
    assert_eq!(res.hits.len(), 1);
}

#[test]
fn search_empty_query_returns_empty() {
    let fx = FsFixture::new();
    fx.write("a.txt", "");
    let res = search(&fx.registry, &fx.root_str(), "   ", None, None).expect("search");
    assert!(res.hits.is_empty());
    assert!(!res.truncated);
}

#[test]
fn search_prunes_node_modules() {
    let fx = FsFixture::new();
    fx.write("node_modules/lodash/index.js", "");
    fx.write("src/index.js", "");

    let res = search(&fx.registry, &fx.root_str(), "index", None, None).expect("search");
    let rels: Vec<&str> = res.hits.iter().map(|h| h.rel.as_str()).collect();
    assert!(rels.iter().any(|r| r.starts_with("src/")));
    assert!(!rels.iter().any(|r| r.starts_with("node_modules")));
}

#[test]
fn search_ranks_filename_hits_before_path_hits() {
    let fx = FsFixture::new();
    fx.write("zeta/inner.txt", "");
    fx.write("beta/zeta.txt", "");

    let res = search(&fx.registry, &fx.root_str(), "zeta", None, None).expect("search");
    let zeta_file = res
        .hits
        .iter()
        .position(|h| h.rel == "beta/zeta.txt")
        .expect("file hit");
    let inner_file = res
        .hits
        .iter()
        .position(|h| h.rel == "zeta/inner.txt")
        .expect("path-only hit");
    assert!(
        zeta_file < inner_file,
        "filename hit should rank before path-only hit",
    );
}

#[test]
fn read_dir_orders_dirs_before_files_then_alpha() {
    let fx = FsFixture::new();
    fx.mkdir("zdir");
    fx.mkdir("adir");
    fx.write("zfile.txt", "");
    fx.write("afile.txt", "");

    let entries = read_dir(&fx.registry, &fx.root_str(), false, None).expect("read_dir");
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["adir", "zdir", "afile.txt", "zfile.txt"]);
    assert!(matches!(entries[0].kind, EntryKind::Dir));
    assert!(matches!(entries[2].kind, EntryKind::File));
}

#[test]
fn read_dir_hides_dotfiles_by_default() {
    let fx = FsFixture::new();
    fx.write(".secret", "");
    fx.write("visible.txt", "");

    let hidden_off = read_dir(&fx.registry, &fx.root_str(), false, None).expect("read_dir");
    let names: Vec<&str> = hidden_off.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["visible.txt"]);

    let hidden_on = read_dir(&fx.registry, &fx.root_str(), true, None).expect("read_dir");
    let names: Vec<&str> = hidden_on.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&".secret"));
}

#[test]
fn read_dir_flags_gitignored_entries_only_when_requested() {
    if !git_available() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file(".gitignore", "ignored.txt\nbuild/\n");
    fx.write_file("kept.txt", "");
    fx.write_file("ignored.txt", "");
    fx.write_file("build/out.o", "");

    let entries = read_dir(&fx.registry, &fx.repo_str(), false, Some(true)).expect("read_dir");
    let flag = |name: &str| {
        entries
            .iter()
            .find(|e| e.name == name)
            .unwrap_or_else(|| panic!("{name} missing"))
            .gitignored
    };
    assert!(!flag("kept.txt"));
    assert!(flag("ignored.txt"));
    assert!(flag("build"));

    let plain = read_dir(&fx.registry, &fx.repo_str(), false, None).expect("read_dir");
    assert!(plain.iter().all(|e| !e.gitignored));
}

#[test]
fn read_dir_skips_gitignore_outside_a_repo() {
    let fx = FsFixture::new();
    fx.write(".gitignore", "ignored.txt\n");
    fx.write("ignored.txt", "");
    fx.write("kept.txt", "");
    let entries = read_dir(&fx.registry, &fx.root_str(), false, Some(true)).expect("read_dir");
    assert!(entries.iter().all(|e| !e.gitignored));
}

#[test]
fn read_dir_returns_size_for_files() {
    let fx = FsFixture::new();
    fx.write("known.txt", "abcdef");

    let entries = read_dir(&fx.registry, &fx.root_str(), false, None).expect("read_dir");
    let entry = entries.iter().find(|e| e.name == "known.txt").unwrap();
    assert_eq!(entry.size, 6);
    assert!(matches!(entry.kind, EntryKind::File));
}

#[test]
fn list_subdirs_returns_only_directories() {
    let fx = FsFixture::new();
    fx.mkdir("dir_a");
    fx.mkdir("dir_b");
    fx.write("not_a_dir.txt", "");

    let dirs = subdirs(&fx.registry, &fx.root_str(), false).expect("list_subdirs");
    assert_eq!(dirs, vec!["dir_a", "dir_b"]);
}

#[test]
fn list_subdirs_hides_dot_dirs_by_default() {
    let fx = FsFixture::new();
    fx.mkdir(".hidden");
    fx.mkdir("visible");

    let off = subdirs(&fx.registry, &fx.root_str(), false).expect("list_subdirs");
    assert_eq!(off, vec!["visible"]);

    let on = subdirs(&fx.registry, &fx.root_str(), true).expect("list_subdirs");
    assert!(on.contains(&".hidden".to_string()));
}
