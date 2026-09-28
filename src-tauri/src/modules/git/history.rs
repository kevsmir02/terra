use crate::modules::git::types::GitLogEntry;

pub(crate) const LOG_FORMAT: &str = "%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s";

/// With `-z` every commit opens with a record separator, so a numstat path
/// can never be mistaken for the next header.
pub(crate) const FILE_LOG_FORMAT: &str = "%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s";

pub(crate) fn sha_is_safe(sha: &str) -> bool {
    !sha.is_empty() && sha.len() <= 64 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

pub(crate) fn parse_log_header(line: &str) -> Option<GitLogEntry> {
    let mut fields = line.splitn(6, '\x1f');
    let sha = fields.next()?.to_string();
    if !sha_is_safe(&sha) {
        return None;
    }
    let author = fields.next()?.to_string();
    let author_email = fields.next().unwrap_or("").to_string();
    let timestamp_secs = fields.next().unwrap_or("0").parse::<i64>().unwrap_or(0);
    let parents = fields
        .next()
        .unwrap_or("")
        .split_ascii_whitespace()
        .map(str::to_string)
        .collect();
    let subject = fields.next().unwrap_or("").to_string();
    let short_sha = sha.chars().take(7).collect();
    Some(GitLogEntry {
        sha,
        short_sha,
        author,
        author_email,
        timestamp_secs,
        parents,
        subject,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        path: None,
        original_path: None,
    })
}

/// Parses `git log -z --numstat --format=FILE_LOG_FORMAT -- <path>`. A commit
/// that touched exactly one path under the filter carries that path (and the
/// pre-rename name under `--follow`); a merge shows no numstat and keeps none.
pub fn parse_file_log(bytes: &[u8]) -> Vec<GitLogEntry> {
    let text = String::from_utf8_lossy(bytes);
    let mut entries = Vec::new();
    for record in text.split('\x1e') {
        let mut tokens = record.split('\0');
        let Some(mut entry) = tokens.next().and_then(parse_log_header) else {
            continue;
        };
        let mut paths: Vec<(String, Option<String>)> = Vec::new();
        while let Some(token) = tokens.next() {
            let token = token.trim_start_matches('\n');
            if token.is_empty() {
                continue;
            }
            let mut parts = token.splitn(3, '\t');
            let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            entry.insertions += added.parse::<u32>().unwrap_or(0);
            entry.deletions += removed.parse::<u32>().unwrap_or(0);
            if path.is_empty() {
                let (Some(from), Some(to)) = (tokens.next(), tokens.next()) else {
                    break;
                };
                paths.push((to.to_string(), Some(from.to_string())));
            } else {
                paths.push((path.to_string(), None));
            }
        }
        entry.files_changed = paths.len() as u32;
        if let [(path, original)] = paths.as_slice() {
            entry.path = Some(path.clone());
            entry.original_path = original.clone();
        }
        entries.push(entry);
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(sha: char, subject: &str) -> String {
        let sha: String = std::iter::repeat_n(sha, 40).collect();
        format!("\x1e{sha}\x1fAda\x1fada@x.dev\x1f1700000000\x1f{sha}\x1f{subject}\0")
    }

    #[test]
    fn a_rename_carries_both_names_and_its_counts() {
        let out = format!(
            "{}\n2\t1\tnew name.txt\0{}\n0\t0\t\0old.txt\0new name.txt\0{}\n3\t0\told.txt\0",
            header('a', "edit"),
            header('b', "rename"),
            header('c', "add"),
        );
        let entries = parse_file_log(out.as_bytes());
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path.as_deref(), Some("new name.txt"));
        assert_eq!(entries[0].original_path, None);
        assert_eq!((entries[0].insertions, entries[0].deletions), (2, 1));
        assert_eq!(entries[1].path.as_deref(), Some("new name.txt"));
        assert_eq!(entries[1].original_path.as_deref(), Some("old.txt"));
        assert_eq!(entries[2].path.as_deref(), Some("old.txt"));
        assert_eq!(entries[2].files_changed, 1);
    }

    #[test]
    fn a_merge_without_numstat_keeps_no_path() {
        let out = format!("{}\n{}\n1\t1\tf.txt\0", header('a', "merge"), header('b', "edit"));
        let entries = parse_file_log(out.as_bytes());
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, None);
        assert_eq!(entries[0].files_changed, 0);
        assert_eq!(entries[1].path.as_deref(), Some("f.txt"));
    }

    #[test]
    fn binary_counts_are_zero_and_a_subject_keeps_its_tabs() {
        let out = format!("{}\n-\t-\tlogo.png\0", header('a', "a\tb"));
        let entries = parse_file_log(out.as_bytes());
        assert_eq!(entries[0].subject, "a\tb");
        assert_eq!((entries[0].insertions, entries[0].deletions), (0, 0));
        assert_eq!(entries[0].path.as_deref(), Some("logo.png"));
    }

    #[test]
    fn a_directory_commit_touching_several_files_names_none() {
        let out = format!("{}\n1\t0\td/a\0\n2\t0\td/b\0", header('a', "two"));
        let entries = parse_file_log(out.as_bytes());
        assert_eq!(entries[0].files_changed, 2);
        assert_eq!(entries[0].insertions, 3);
        assert_eq!(entries[0].path, None);
    }

    #[test]
    fn a_header_with_an_unsafe_sha_is_dropped() {
        let out = "\x1e--all\x1fx\x1fy\x1f0\x1f\x1fs\0\n1\t1\tf\0";
        assert!(parse_file_log(out.as_bytes()).is_empty());
    }

    #[test]
    fn a_truncated_rename_does_not_panic() {
        let out = format!("{}\n0\t0\t\0old.txt", header('a', "cut"));
        let entries = parse_file_log(out.as_bytes());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, None);
    }
}
