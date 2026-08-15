use std::collections::BTreeSet;

use super::spec::SiteKind;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSite {
    pub kind: SiteKind,
    pub docroot: String,
    /// False when nothing matched and the result is a fallback guess, so the
    /// UI can say so instead of pretending.
    pub confident: bool,
}

fn php(docroot: &str) -> DetectedSite {
    DetectedSite { kind: SiteKind::Php, docroot: docroot.into(), confident: true }
}

pub fn detect_site(files: &BTreeSet<String>, dirs: &BTreeSet<String>) -> DetectedSite {
    let has = |f: &str| files.contains(f);
    let public = dirs.contains("public");

    if (has("artisan") || has("composer.json")) && public {
        return php("public");
    }
    if has("composer.json") || has("index.php") {
        return php(".");
    }
    if has("index.html") {
        return DetectedSite {
            kind: SiteKind::Static,
            docroot: ".".into(),
            confident: true,
        };
    }
    DetectedSite { kind: SiteKind::Static, docroot: ".".into(), confident: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn laravel_wins_over_the_node_marker_it_also_has() {
        // Every Laravel project has package.json too. Resolving it as a Node
        // project would serve nothing.
        let got = detect_site(&set(&["artisan", "composer.json", "package.json"]), &set(&["public"]));
        assert_eq!(got.kind, SiteKind::Php);
        assert_eq!(got.docroot, "public");
        assert!(got.confident);
    }

    #[test]
    fn composer_without_a_public_dir_serves_the_root() {
        let got = detect_site(&set(&["composer.json"]), &set(&[]));
        assert_eq!(got.kind, SiteKind::Php);
        assert_eq!(got.docroot, ".");
    }

    #[test]
    fn a_bare_index_php_is_a_php_site() {
        let got = detect_site(&set(&["index.php"]), &set(&[]));
        assert_eq!(got.kind, SiteKind::Php);
    }

    #[test]
    fn an_index_html_is_a_static_site() {
        let got = detect_site(&set(&["index.html"]), &set(&[]));
        assert_eq!(got.kind, SiteKind::Static);
        assert!(got.confident);
    }

    #[test]
    fn an_unrecognised_directory_is_a_flagged_guess() {
        let got = detect_site(&set(&["README.md"]), &set(&["src"]));
        assert_eq!(got.kind, SiteKind::Static);
        assert!(!got.confident);
    }
}
