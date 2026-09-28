use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use ignore::{WalkBuilder, WalkState};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use super::file::{mtime_millis, write_atomic, FileWrittenEvent, BINARY_SNIFF_BYTES, MAX_READ_BYTES};
use super::{authorized_read, authorized_write, to_canon};
use crate::modules::blocking::{on_app, on_registry as blocking};
use crate::modules::sync::MutexExt;
use crate::modules::workspace::WorkspaceRegistry;

/// Past either cap the preview is marked truncated and cannot be applied: a
/// change that size is not one the user can review match by match.
pub const MAX_FILES: usize = 500;
pub const MAX_MATCHES: usize = 5_000;
const MAX_SKIPPED_LISTED: usize = 50;
const BEFORE_CHARS: usize = 48;
const MATCH_CHARS: usize = 160;
const AFTER_CHARS: usize = 96;
const UTF8_BOM: &str = "\u{feff}";

/// Supersession counter: a newer preview makes an in-flight walk quit.
#[derive(Default)]
pub struct ReplacePreviewState {
    generation: AtomicU64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceQuery {
    pub pattern: String,
    pub replacement: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    /// Byte range in the file, the unit apply splices in.
    pub start: usize,
    pub end: usize,
    pub line: u64,
    pub before: String,
    pub matched: String,
    pub after: String,
    pub replacement: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub path: String,
    pub rel: String,
    /// SHA-256 of the bytes the edits were computed against; apply refuses the
    /// file when the disk no longer hashes to it.
    pub hash: String,
    pub edits: Vec<Edit>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    NotUtf8,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub path: String,
    pub rel: String,
    pub reason: SkipReason,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreview {
    pub files: Vec<FilePreview>,
    pub total_matches: usize,
    pub files_scanned: usize,
    pub truncated: bool,
    pub skipped: Vec<SkippedFile>,
    pub skipped_large: usize,
}

/// The replacement engine: a compiled query plus its template.
pub struct Replacer {
    regex: Regex,
    template: String,
    expand: bool,
}

impl Replacer {
    pub fn new(query: &ReplaceQuery) -> Result<Self, String> {
        if query.pattern.is_empty() {
            return Err("empty pattern".into());
        }
        let body = if query.regex {
            query.pattern.clone()
        } else {
            regex::escape(&query.pattern)
        };
        let body = if query.whole_word {
            whole_word(&body, &query.pattern, query.regex)
        } else {
            body
        };
        let regex = RegexBuilder::new(&body)
            .case_insensitive(!query.case_sensitive)
            .build()
            .map_err(|e| format!("bad regex: {e}"))?;
        Ok(Self {
            regex,
            template: query.replacement.clone(),
            expand: query.regex,
        })
    }

    pub fn is_match(&self, text: &str) -> bool {
        lines(text).any(|(_, _, line)| self.regex.is_match(line))
    }

    /// Edits for `text`, matched one line at a time so no match spans a line
    /// ending and every EOL survives the splice. Returns at most `limit` and
    /// whether more were left.
    pub fn edits(&self, text: &str, limit: usize) -> (Vec<Edit>, bool) {
        let eol = detect_eol(text);
        let mut out = Vec::new();
        for (number, offset, line) in lines(text) {
            if self.expand {
                for caps in self.regex.captures_iter(line) {
                    let m = caps.get(0).expect("group 0 always participates");
                    let mut rep = String::new();
                    caps.expand(&self.template, &mut rep);
                    if out.len() == limit {
                        return (out, true);
                    }
                    out.push(edit(line, offset, number, m.start(), m.end(), &rep, eol));
                }
            } else {
                for m in self.regex.find_iter(line) {
                    if out.len() == limit {
                        return (out, true);
                    }
                    out.push(edit(line, offset, number, m.start(), m.end(), &self.template, eol));
                }
            }
        }
        (out, false)
    }
}

/// Half boundaries, not `\b`: no word may continue on the outer side. A
/// literal that starts or ends on punctuation needs no guard on that side, so
/// whole-word `call(` still matches `call(x)`; a regex edge is unknowable.
fn whole_word(body: &str, pattern: &str, regex: bool) -> String {
    let is_word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    let lead = regex || is_word(pattern.chars().next());
    let trail = regex || is_word(pattern.chars().next_back());
    format!(
        "{}(?:{body}){}",
        if lead { r"\b{start-half}" } else { "" },
        if trail { r"\b{end-half}" } else { "" },
    )
}

fn edit(line: &str, offset: usize, number: u64, start: usize, end: usize, rep: &str, eol: &str) -> Edit {
    Edit {
        start: offset + start,
        end: offset + end,
        line: number,
        before: clip_tail(&line[..start], BEFORE_CHARS),
        matched: clip_head(&line[start..end], MATCH_CHARS),
        after: clip_head(&line[end..], AFTER_CHARS),
        replacement: normalize_newlines(rep, eol),
    }
}

/// `(1-based number, byte offset, content)` per line, the terminator and any
/// BOM excluded. A trailing newline does not open an empty last line.
fn lines(text: &str) -> impl Iterator<Item = (u64, usize, &str)> {
    let start = if text.starts_with(UTF8_BOM) { UTF8_BOM.len() } else { 0 };
    let mut cursor = start;
    let mut number = 0u64;
    std::iter::from_fn(move || {
        if cursor >= text.len() {
            return None;
        }
        let rest = &text[cursor..];
        let (raw, advance) = match rest.find('\n') {
            Some(i) => (&rest[..i], i + 1),
            None => (rest, rest.len()),
        };
        let content = raw.strip_suffix('\r').unwrap_or(raw);
        let at = cursor;
        cursor += advance;
        number += 1;
        Some((number, at, content))
    })
}

fn detect_eol(text: &str) -> &'static str {
    match text.find('\n') {
        Some(i) if i > 0 && text.as_bytes()[i - 1] == b'\r' => "\r\n",
        _ => "\n",
    }
}

fn normalize_newlines(s: &str, eol: &str) -> String {
    if !s.contains('\n') {
        return s.to_string();
    }
    s.replace("\r\n", "\n").replace('\n', eol)
}

fn clip_head(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

fn clip_tail(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let (i, _) = s.char_indices().nth(count - max).expect("in range");
    format!("…{}", &s[i..])
}

/// Include and exclude globs as the user types them: a bare name matches at
/// any depth and covers a directory's contents, a leading `/` anchors it to
/// the search root, and `*` never crosses a `/`.
pub struct PathFilter {
    include: Option<GlobSet>,
    exclude: Option<GlobSet>,
}

impl PathFilter {
    pub fn new(include: &[String], exclude: &[String]) -> Result<Self, String> {
        Ok(Self {
            include: glob_set(include)?,
            exclude: glob_set(exclude)?,
        })
    }

    pub fn allows(&self, rel: &str) -> bool {
        if self.exclude.as_ref().is_some_and(|set| set.is_match(rel)) {
            return false;
        }
        self.include.as_ref().is_none_or(|set| set.is_match(rel))
    }
}

fn expand_glob(raw: &str) -> Vec<String> {
    let trimmed = raw.trim().trim_start_matches("./").trim_end_matches('/');
    let anchored = trimmed.starts_with('/');
    let p = trimmed.trim_start_matches('/');
    if p.is_empty() {
        return Vec::new();
    }
    let mut out = vec![p.to_string(), format!("{p}/**")];
    if !anchored && !p.starts_with("**/") {
        out.push(format!("**/{p}"));
        out.push(format!("**/{p}/**"));
    }
    out
}

fn glob_set(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    let mut builder = GlobSetBuilder::new();
    let mut any = false;
    for raw in patterns {
        for p in expand_glob(raw) {
            let glob = GlobBuilder::new(&p)
                .literal_separator(true)
                .build()
                .map_err(|e| format!("bad glob {raw:?}: {e}"))?;
            builder.add(glob);
            any = true;
        }
    }
    if !any {
        return Ok(None);
    }
    builder.build().map(Some).map_err(|e| format!("bad glob: {e}"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0)
}

enum Scan {
    Nothing,
    Large,
    NotUtf8,
    Matches(Vec<Edit>, String, bool),
}

fn scan_file(path: &Path, replacer: &Replacer, limit: usize) -> Scan {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() > MAX_READ_BYTES => return Scan::Large,
        Ok(_) => {}
        Err(_) => return Scan::Nothing,
    }
    let Ok(bytes) = std::fs::read(path) else {
        return Scan::Nothing;
    };
    if looks_binary(&bytes) {
        return Scan::Nothing;
    }
    let text = match std::str::from_utf8(&bytes) {
        Ok(text) => text,
        Err(_) => {
            return if replacer.is_match(&String::from_utf8_lossy(&bytes)) {
                Scan::NotUtf8
            } else {
                Scan::Nothing
            };
        }
    };
    let (edits, more) = replacer.edits(text, limit);
    if edits.is_empty() {
        return Scan::Nothing;
    }
    Scan::Matches(edits, sha256_hex(&bytes), more)
}

fn preview_tree(
    root: &Path,
    replacer: &Replacer,
    filter: &PathFilter,
    cancel: &(dyn Fn() -> bool + Sync),
) -> ReplacePreview {
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build_parallel();

    let files: Arc<Mutex<Vec<FilePreview>>> = Arc::default();
    let skipped: Arc<Mutex<Vec<SkippedFile>>> = Arc::default();
    let matches = AtomicUsize::new(0);
    let scanned = AtomicUsize::new(0);
    let large = AtomicUsize::new(0);
    let truncated = AtomicBool::new(false);

    walker.run(|| {
        let (files, skipped) = (files.clone(), skipped.clone());
        let (matches, scanned, large, truncated) = (&matches, &scanned, &large, &truncated);
        Box::new(move |entry| {
            if truncated.load(Ordering::Relaxed) || cancel() {
                return WalkState::Quit;
            }
            let Ok(entry) = entry else {
                return WalkState::Continue;
            };
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                return WalkState::Continue;
            }
            let path = entry.path();
            let Ok(rel) = path.strip_prefix(root).map(to_canon) else {
                return WalkState::Continue;
            };
            if !filter.allows(&rel) {
                return WalkState::Continue;
            }
            scanned.fetch_add(1, Ordering::Relaxed);
            let budget = MAX_MATCHES.saturating_sub(matches.load(Ordering::Relaxed));
            match scan_file(path, replacer, budget) {
                Scan::Nothing => {}
                Scan::Large => {
                    large.fetch_add(1, Ordering::Relaxed);
                }
                Scan::NotUtf8 => {
                    let mut list = skipped.lock_or_recover();
                    if list.len() < MAX_SKIPPED_LISTED {
                        list.push(SkippedFile {
                            path: to_canon(path),
                            rel,
                            reason: SkipReason::NotUtf8,
                        });
                    }
                }
                Scan::Matches(edits, hash, more) => {
                    let total = matches.fetch_add(edits.len(), Ordering::Relaxed) + edits.len();
                    let mut list = files.lock_or_recover();
                    if more || total > MAX_MATCHES || list.len() >= MAX_FILES {
                        truncated.store(true, Ordering::Relaxed);
                    }
                    if list.len() < MAX_FILES {
                        list.push(FilePreview {
                            path: to_canon(path),
                            rel,
                            hash,
                            edits,
                        });
                    }
                }
            }
            WalkState::Continue
        })
    });

    let mut files = std::mem::take(&mut *files.lock_or_recover());
    files.sort_by(|a, b| a.rel.cmp(&b.rel));
    let mut skipped = std::mem::take(&mut *skipped.lock_or_recover());
    skipped.sort_by(|a, b| a.rel.cmp(&b.rel));
    ReplacePreview {
        total_matches: files.iter().map(|f| f.edits.len()).sum(),
        files,
        files_scanned: scanned.into_inner(),
        truncated: truncated.into_inner(),
        skipped,
        skipped_large: large.into_inner(),
    }
}

pub fn preview(
    registry: &WorkspaceRegistry,
    root: &str,
    query: &ReplaceQuery,
    cancel: &(dyn Fn() -> bool + Sync),
) -> Result<ReplacePreview, String> {
    let replacer = Replacer::new(query)?;
    let filter = PathFilter::new(&query.include, &query.exclude)?;
    let root_path = authorized_read(registry, root)?;
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    Ok(preview_tree(&root_path, &replacer, &filter, cancel))
}

#[tauri::command]
pub async fn fs_replace_preview(
    root: String,
    query: ReplaceQuery,
    app: AppHandle,
) -> Result<ReplacePreview, String> {
    on_app(app, move |app| {
        let state = app.state::<ReplacePreviewState>();
        let mine = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let cancel = || state.generation.load(Ordering::SeqCst) != mine;
        let result = preview(&app.state::<WorkspaceRegistry>(), &root, &query, &cancel)?;
        if cancel() {
            return Err("superseded".into());
        }
        Ok(result)
    })
    .await
}

/// Stops an in-flight preview when the view closes or its query clears, so a
/// walk over a large root never outlives the surface that asked for it.
#[tauri::command]
pub async fn fs_replace_cancel(state: tauri::State<'_, ReplacePreviewState>) -> Result<(), String> {
    state.generation.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyEdit {
    pub start: usize,
    pub end: usize,
    pub replacement: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyFile {
    pub path: String,
    pub hash: String,
    pub edits: Vec<ApplyEdit>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ApplyOutcome {
    Written,
    Conflict,
    Failed,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    /// As the caller sent it, so the UI can match results to its rows.
    pub path: String,
    pub outcome: ApplyOutcome,
    pub replaced: usize,
    pub mtime: Option<u64>,
    pub message: Option<String>,
    #[serde(skip)]
    pub written_to: Option<PathBuf>,
}

impl ApplyResult {
    fn refused(path: &str, outcome: ApplyOutcome, message: impl Into<String>) -> Self {
        Self {
            path: path.to_string(),
            outcome,
            replaced: 0,
            mtime: None,
            message: Some(message.into()),
            written_to: None,
        }
    }
}

/// Splices `edits` into `text`. They must be ascending, disjoint, on char
/// boundaries and inside the text; two empty edits at one offset would insert
/// twice, so an empty edit must also start past the previous one's end.
pub fn splice(text: &str, edits: &[ApplyEdit]) -> Result<String, String> {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    let mut prev_end: Option<usize> = None;
    for e in edits {
        let in_order = match prev_end {
            None => true,
            Some(p) if e.start == e.end => e.start > p,
            Some(p) => e.start >= p,
        };
        if !in_order || e.start > e.end || e.end > text.len() {
            return Err(format!("edit {}..{} is out of order or out of range", e.start, e.end));
        }
        if !text.is_char_boundary(e.start) || !text.is_char_boundary(e.end) {
            return Err(format!("edit {}..{} splits a character", e.start, e.end));
        }
        out.push_str(&text[cursor..e.start]);
        out.push_str(&e.replacement);
        cursor = e.end;
        prev_end = Some(e.end);
    }
    out.push_str(&text[cursor..]);
    Ok(out)
}

fn apply_file(registry: &WorkspaceRegistry, file: &ApplyFile) -> ApplyResult {
    use ApplyOutcome::{Conflict, Failed};
    let target = match authorized_write(registry, &file.path) {
        Ok(p) => p,
        Err(e) => return ApplyResult::refused(&file.path, Failed, e),
    };
    match std::fs::metadata(&target) {
        Ok(meta) if !meta.is_file() => {
            return ApplyResult::refused(&file.path, Failed, "not a regular file")
        }
        Ok(meta) if meta.len() > MAX_READ_BYTES => {
            return ApplyResult::refused(&file.path, Failed, "file is over the 10 MB editor limit")
        }
        Ok(_) => {}
        Err(e) => return ApplyResult::refused(&file.path, Failed, e.to_string()),
    }
    let bytes = match std::fs::read(&target) {
        Ok(b) => b,
        Err(e) => return ApplyResult::refused(&file.path, Failed, e.to_string()),
    };
    if sha256_hex(&bytes) != file.hash {
        return ApplyResult::refused(&file.path, Conflict, "changed on disk since the preview");
    }
    if looks_binary(&bytes) {
        return ApplyResult::refused(&file.path, Failed, "binary file");
    }
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return ApplyResult::refused(&file.path, Failed, "not UTF-8");
    };
    let next = match splice(text, &file.edits) {
        Ok(next) => next,
        Err(e) => return ApplyResult::refused(&file.path, Failed, e),
    };
    if let Err(e) = write_atomic(&target, next.as_bytes()) {
        log::warn!("fs_replace_apply({}) failed: {e}", target.display());
        return ApplyResult::refused(&file.path, Failed, e.to_string());
    }
    ApplyResult {
        path: file.path.clone(),
        outcome: ApplyOutcome::Written,
        replaced: file.edits.len(),
        mtime: std::fs::metadata(&target).ok().map(|m| mtime_millis(&m)),
        message: None,
        written_to: Some(target),
    }
}

/// Writes each confirmed file independently: one conflict or failure is
/// reported on its own row and never stops the rest.
pub fn apply(registry: &WorkspaceRegistry, files: &[ApplyFile]) -> Result<Vec<ApplyResult>, String> {
    if files.len() > MAX_FILES {
        return Err(format!("too many files: {} (limit {MAX_FILES})", files.len()));
    }
    let edits: usize = files.iter().map(|f| f.edits.len()).sum();
    if edits > MAX_MATCHES {
        return Err(format!("too many replacements: {edits} (limit {MAX_MATCHES})"));
    }
    Ok(files.iter().map(|f| apply_file(registry, f)).collect())
}

#[tauri::command]
pub async fn fs_replace_apply(
    files: Vec<ApplyFile>,
    app: AppHandle,
) -> Result<Vec<ApplyResult>, String> {
    let results = blocking(app.clone(), move |r| apply(r, &files)).await?;
    for written in results.iter().filter_map(|r| r.written_to.as_ref()) {
        let _ = app.emit(
            "fs:file-written",
            FileWrittenEvent {
                path: to_canon(written),
                source: Some("replace".into()),
            },
        );
    }
    Ok(results)
}

#[cfg(test)]
mod engine_tests {
    use super::*;

    fn query(pattern: &str, replacement: &str) -> ReplaceQuery {
        ReplaceQuery {
            pattern: pattern.into(),
            replacement: replacement.into(),
            case_sensitive: true,
            ..Default::default()
        }
    }

    fn run(q: &ReplaceQuery, text: &str) -> String {
        let (edits, more) = Replacer::new(q).unwrap().edits(text, usize::MAX);
        assert!(!more);
        let apply: Vec<ApplyEdit> = edits
            .into_iter()
            .map(|e| ApplyEdit {
                start: e.start,
                end: e.end,
                replacement: e.replacement,
            })
            .collect();
        splice(text, &apply).unwrap()
    }

    #[test]
    fn literal_mode_treats_metacharacters_and_dollars_literally() {
        let q = query("a.b(", "$1x");
        assert_eq!(run(&q, "a.b( axb("), "$1x axb(");
    }

    #[test]
    fn regex_mode_expands_numbered_and_named_captures() {
        let q = ReplaceQuery {
            regex: true,
            ..query(r"(?P<user>\w+)@(\w+)", "$2 at ${user}")
        };
        assert_eq!(run(&q, "mail ann@home, bob@work"), "mail home at ann, work at bob");
    }

    #[test]
    fn whole_word_skips_matches_inside_words() {
        let q = ReplaceQuery {
            whole_word: true,
            ..query("foo", "X")
        };
        assert_eq!(run(&q, "foo foobar barfoo foo_x (foo) foo"), "X foobar barfoo foo_x (X) X");
    }

    #[test]
    fn whole_word_allows_a_pattern_that_ends_on_punctuation() {
        let q = ReplaceQuery {
            whole_word: true,
            ..query("call(", "invoke(")
        };
        assert_eq!(run(&q, "call(x) recall(y)"), "invoke(x) recall(y)");
    }

    #[test]
    fn overlapping_candidates_match_leftmost_and_never_overlap() {
        let q = query("aa", "X");
        assert_eq!(run(&q, "aaaaa aa"), "XXa X");
        let (edits, _) = Replacer::new(&q).unwrap().edits("aaa", usize::MAX);
        assert_eq!(edits.len(), 1);
    }

    #[test]
    fn case_insensitive_is_the_default() {
        let q = ReplaceQuery {
            case_sensitive: false,
            ..query("foo", "bar")
        };
        assert_eq!(run(&q, "Foo FOO foo"), "bar bar bar");
    }

    #[test]
    fn crlf_endings_survive_and_anchors_see_the_line_without_its_cr() {
        let q = ReplaceQuery {
            regex: true,
            ..query("foo$", "baz")
        };
        assert_eq!(run(&q, "a foo\r\nfoo\r\nfoo x\r\n"), "a baz\r\nbaz\r\nfoo x\r\n");
    }

    #[test]
    fn a_newline_in_the_replacement_takes_the_files_eol() {
        let q = query("x", "1\n2");
        assert_eq!(run(&q, "x\r\ny\r\n"), "1\r\n2\r\ny\r\n");
        assert_eq!(run(&q, "x\ny\n"), "1\n2\ny\n");
    }

    #[test]
    fn no_match_spans_a_line_ending() {
        let q = ReplaceQuery {
            regex: true,
            ..query(r"a\s+b", "X")
        };
        assert_eq!(run(&q, "a\nb a  b"), "a\nb X");
    }

    #[test]
    fn a_bom_is_kept_and_does_not_hide_a_line_start() {
        let q = ReplaceQuery {
            regex: true,
            ..query("^foo", "bar")
        };
        assert_eq!(run(&q, "\u{feff}foo\nfoo"), "\u{feff}bar\nbar");
    }

    #[test]
    fn empty_matches_insert_once_per_line() {
        let q = ReplaceQuery {
            regex: true,
            ..query("^", "> ")
        };
        assert_eq!(run(&q, "a\n\nb\n"), "> a\n> \n> b\n");
    }

    #[test]
    fn edits_stop_at_the_limit_and_say_so() {
        let (edits, more) = Replacer::new(&query("a", "b")).unwrap().edits("aaaa", 3);
        assert_eq!(edits.len(), 3);
        assert!(more);
        let (edits, more) = Replacer::new(&query("a", "b")).unwrap().edits("aaa", 3);
        assert_eq!(edits.len(), 3);
        assert!(!more);
    }

    #[test]
    fn line_numbers_and_context_are_reported() {
        let (edits, _) = Replacer::new(&query("b", "B")).unwrap().edits("a\nxx b yy\n", 10);
        assert_eq!(edits.len(), 1);
        let e = &edits[0];
        assert_eq!((e.line, e.before.as_str(), e.matched.as_str(), e.after.as_str()), (2, "xx ", "b", " yy"));
    }

    #[test]
    fn a_bad_regex_or_empty_pattern_is_an_error() {
        assert!(Replacer::new(&query("", "x")).is_err());
        let q = ReplaceQuery {
            regex: true,
            ..query("(unclosed", "x")
        };
        assert!(Replacer::new(&q).err().expect("refused").contains("bad regex"));
    }

    fn e(start: usize, end: usize) -> ApplyEdit {
        ApplyEdit {
            start,
            end,
            replacement: "_".into(),
        }
    }

    #[test]
    fn splice_refuses_overlapping_unordered_or_out_of_range_edits() {
        assert!(splice("abcdef", &[e(0, 3), e(2, 4)]).is_err());
        assert!(splice("abcdef", &[e(3, 4), e(0, 1)]).is_err());
        assert!(splice("abc", &[e(2, 9)]).is_err());
        assert!(splice("abc", &[e(2, 1)]).is_err());
        assert!(splice("abc", &[e(1, 1), e(1, 1)]).is_err());
        assert_eq!(splice("abc", &[e(0, 1), e(1, 2)]).unwrap(), "__c");
    }

    #[test]
    fn splice_refuses_to_split_a_character() {
        assert!(splice("é", &[e(1, 2)]).is_err());
    }

    #[test]
    fn path_filter_matches_names_at_any_depth_and_anchors_on_a_slash() {
        let f = PathFilter::new(&["*.ts".into()], &["node_modules".into(), "/dist".into()]).unwrap();
        assert!(f.allows("a.ts"));
        assert!(f.allows("src/deep/a.ts"));
        assert!(!f.allows("src/a.tsx"));
        assert!(!f.allows("node_modules/x/a.ts"));
        assert!(!f.allows("pkg/node_modules/a.ts"));
        assert!(!f.allows("dist/a.ts"));
        assert!(f.allows("src/dist/a.ts"));
        let only_src = PathFilter::new(&["src/*.rs".into()], &[]).unwrap();
        assert!(only_src.allows("src/a.rs"));
        assert!(!only_src.allows("src/deep/a.rs"));
        assert!(PathFilter::new(&["a[".into()], &[]).is_err());
    }
}

#[cfg(test)]
mod authorization_tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, tempfile::TempDir, WorkspaceRegistry) {
        let inside = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("tempdir");
        let registry = WorkspaceRegistry::default();
        registry.authorize(inside.path()).expect("authorize");
        (inside, outside, registry)
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    fn q(pattern: &str, replacement: &str) -> ReplaceQuery {
        ReplaceQuery {
            pattern: pattern.into(),
            replacement: replacement.into(),
            case_sensitive: true,
            ..Default::default()
        }
    }

    fn confirm(preview: &ReplacePreview) -> Vec<ApplyFile> {
        preview
            .files
            .iter()
            .map(|f| ApplyFile {
                path: f.path.clone(),
                hash: f.hash.clone(),
                edits: f
                    .edits
                    .iter()
                    .map(|e| ApplyEdit {
                        start: e.start,
                        end: e.end,
                        replacement: e.replacement.clone(),
                    })
                    .collect(),
            })
            .collect()
    }

    fn one(path: &Path, content: &[u8], edits: Vec<ApplyEdit>) -> ApplyFile {
        ApplyFile {
            path: s(path),
            hash: sha256_hex(content),
            edits,
        }
    }

    fn whole(content: &str) -> Vec<ApplyEdit> {
        vec![ApplyEdit {
            start: 0,
            end: content.len(),
            replacement: "pwned".into(),
        }]
    }

    #[test]
    fn preview_refuses_a_root_outside_every_workspace() {
        let (_inside, outside, reg) = fixture();
        std::fs::write(outside.path().join("a.txt"), "secret").unwrap();
        let err = preview(&reg, &s(outside.path()), &q("secret", "x"), &|| false).unwrap_err();
        assert!(err.contains("outside the authorized workspace"), "got: {err}");
    }

    #[test]
    fn preview_never_reads_through_a_link_that_points_outside() {
        let (inside, outside, reg) = fixture();
        std::fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), inside.path().join("file")).unwrap();
        std::os::unix::fs::symlink(outside.path(), inside.path().join("dir")).unwrap();
        let got = preview(&reg, &s(inside.path()), &q("secret", "x"), &|| false).unwrap();
        assert!(got.files.is_empty(), "got: {:?}", got.files);
    }

    #[test]
    fn apply_refuses_a_path_outside_every_root() {
        let (_inside, outside, reg) = fixture();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, "secret").unwrap();
        let results = apply(&reg, &[one(&secret, b"secret", whole("secret"))]).unwrap();
        assert_eq!(results[0].outcome, ApplyOutcome::Failed);
        assert!(results[0].message.as_deref().unwrap().contains("outside the authorized workspace"));
        assert_eq!(std::fs::read_to_string(&secret).unwrap(), "secret");
    }

    #[test]
    fn apply_refuses_a_link_inside_the_root_that_points_outside() {
        let (inside, outside, reg) = fixture();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, "secret").unwrap();
        let link = inside.path().join("note.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let results = apply(&reg, &[one(&link, b"secret", whole("secret"))]).unwrap();
        assert_eq!(results[0].outcome, ApplyOutcome::Failed);
        assert_eq!(std::fs::read_to_string(&secret).unwrap(), "secret");
        assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
    }

    #[test]
    fn a_file_changed_since_the_preview_is_a_conflict_and_left_alone() {
        let (inside, _outside, reg) = fixture();
        let a = inside.path().join("a.txt");
        let b = inside.path().join("b.txt");
        std::fs::write(&a, "old old").unwrap();
        std::fs::write(&b, "old").unwrap();
        let shown = preview(&reg, &s(inside.path()), &q("old", "new"), &|| false).unwrap();
        std::fs::write(&a, "old old, edited by an agent").unwrap();

        let results = apply(&reg, &confirm(&shown)).unwrap();
        let by_name = |n: &str| results.iter().find(|r| r.path.ends_with(n)).unwrap();
        assert_eq!(by_name("a.txt").outcome, ApplyOutcome::Conflict);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "old old, edited by an agent");
        assert_eq!(by_name("b.txt").outcome, ApplyOutcome::Written, "one conflict never stops the rest");
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "new");
    }

    #[test]
    fn apply_refuses_a_file_that_is_not_utf8_even_with_a_matching_hash() {
        let (inside, _outside, reg) = fixture();
        let f = inside.path().join("latin1.txt");
        let bytes = b"caf\xe9 old".to_vec();
        std::fs::write(&f, &bytes).unwrap();
        let edits = vec![ApplyEdit { start: 5, end: 8, replacement: "new".into() }];
        let results = apply(&reg, &[one(&f, &bytes, edits)]).unwrap();
        assert_eq!(results[0].outcome, ApplyOutcome::Failed);
        assert_eq!(std::fs::read(&f).unwrap(), bytes);
    }

    #[test]
    fn preview_lists_non_utf8_matches_as_skipped_and_ignores_binaries_and_big_files() {
        let (inside, _outside, reg) = fixture();
        std::fs::write(inside.path().join("latin1.txt"), b"caf\xe9 old").unwrap();
        std::fs::write(inside.path().join("blob.bin"), b"old\0old").unwrap();
        let mut big = vec![b'a'; (MAX_READ_BYTES + 1) as usize];
        big.extend_from_slice(b"old");
        std::fs::write(inside.path().join("big.txt"), big).unwrap();
        let got = preview(&reg, &s(inside.path()), &q("old", "new"), &|| false).unwrap();
        assert!(got.files.is_empty());
        assert_eq!(got.skipped.len(), 1);
        assert_eq!(got.skipped[0].reason, SkipReason::NotUtf8);
        assert_eq!(got.skipped_large, 1);
    }

    #[test]
    fn preview_respects_gitignore_and_the_path_filter() {
        let (inside, _outside, reg) = fixture();
        std::fs::create_dir(inside.path().join(".git")).unwrap();
        std::fs::write(inside.path().join(".gitignore"), "ignored.txt\n").unwrap();
        std::fs::write(inside.path().join("ignored.txt"), "old").unwrap();
        std::fs::write(inside.path().join("kept.txt"), "old").unwrap();
        std::fs::write(inside.path().join("kept.md"), "old").unwrap();
        let got = preview(&reg, &s(inside.path()), &q("old", "new"), &|| false).unwrap();
        let rels: Vec<_> = got.files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(rels, ["kept.md", "kept.txt"]);
        let only_txt = ReplaceQuery {
            include: vec!["*.txt".into()],
            ..q("old", "new")
        };
        let got = preview(&reg, &s(inside.path()), &only_txt, &|| false).unwrap();
        let rels: Vec<_> = got.files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(rels, ["kept.txt"]);
    }

    #[test]
    fn a_preview_over_the_match_cap_is_truncated() {
        let (inside, _outside, reg) = fixture();
        std::fs::write(inside.path().join("many.txt"), "x ".repeat(MAX_MATCHES + 1)).unwrap();
        let got = preview(&reg, &s(inside.path()), &q("x", "y"), &|| false).unwrap();
        assert!(got.truncated);
        assert!(got.total_matches <= MAX_MATCHES);
    }

    #[test]
    fn apply_refuses_a_request_over_the_caps() {
        let (inside, _outside, reg) = fixture();
        let f = inside.path().join("a.txt");
        std::fs::write(&f, "a").unwrap();
        let many = vec![one(&f, b"a", vec![]); MAX_FILES + 1];
        assert!(apply(&reg, &many).unwrap_err().contains("too many files"));
        let edits = (0..=MAX_MATCHES).map(|i| ApplyEdit { start: i, end: i, replacement: String::new() }).collect();
        assert!(apply(&reg, &[one(&f, b"a", edits)]).unwrap_err().contains("too many replacements"));
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "a");
    }

    #[test]
    fn preview_then_apply_keeps_crlf_and_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let (inside, _outside, reg) = fixture();
        let f = inside.path().join("run.sh");
        std::fs::write(&f, "echo old\r\nold\r\n").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o750)).unwrap();
        let shown = preview(&reg, &s(inside.path()), &q("old", "new"), &|| false).unwrap();
        assert_eq!(shown.total_matches, 2);
        let results = apply(&reg, &confirm(&shown)).unwrap();
        assert_eq!(results[0].outcome, ApplyOutcome::Written);
        assert_eq!(results[0].replaced, 2);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "echo new\r\nnew\r\n");
        let mode = std::fs::metadata(&f).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o750);
    }

    #[test]
    fn a_cancelled_preview_stops_walking() {
        let (inside, _outside, reg) = fixture();
        std::fs::write(inside.path().join("a.txt"), "old").unwrap();
        let got = preview(&reg, &s(inside.path()), &q("old", "new"), &|| true).unwrap();
        assert!(got.files.is_empty());
    }
}
