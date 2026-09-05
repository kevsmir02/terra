pub mod file;
pub mod grep;
pub mod mutate;
pub mod search;
pub mod tree;
pub mod watch;

use std::path::{Path, PathBuf};

use crate::modules::workspace::WorkspaceRegistry;

fn outside(p: &Path) -> String {
    format!("path is outside the authorized workspace: {}", p.display())
}

/// Gate for an fs path that must already exist. Canonicalizing first is what
/// makes the check meaningful: `..` is collapsed and symlinks are followed, so
/// the authorized root is compared against the real target, not the spelling.
///
/// Reads go through the registry's TTL cache; mutations must not, since a stale
/// entry is exactly the symlink-swap window a delete or overwrite would lose to.
pub fn authorized_read(
    registry: &WorkspaceRegistry,
    path: &str,
) -> Result<PathBuf, String> {
    let resolved = PathBuf::from(path);
    let canonical = registry
        .canonicalize_cached(&resolved)
        .map_err(|e| format!("{}: {e}", resolved.display()))?;
    if !registry.is_authorized(&canonical) {
        return Err(outside(&canonical));
    }
    Ok(canonical)
}

/// Same as [`authorized_read`], but always re-resolves. Use for anything that
/// writes, renames, or deletes.
pub fn authorized_write(
    registry: &WorkspaceRegistry,
    path: &str,
) -> Result<PathBuf, String> {
    let resolved = PathBuf::from(path);
    let canonical =
        std::fs::canonicalize(&resolved).map_err(|e| format!("{}: {e}", resolved.display()))?;
    if !registry.is_authorized(&canonical) {
        return Err(outside(&canonical));
    }
    Ok(canonical)
}

/// Gate for an existing entry that must be acted on *as itself*, never as what
/// it points at: delete and rename operate on a symlink, not its target, so
/// resolving the final component would retarget the operation. The parent is
/// canonicalized and authorized; the final component is re-joined verbatim.
pub fn authorized_entry(
    registry: &WorkspaceRegistry,
    path: &str,
) -> Result<PathBuf, String> {
    let resolved = PathBuf::from(path);
    let (Some(name), Some(parent)) = (resolved.file_name(), resolved.parent()) else {
        return Err(format!("invalid path: {}", resolved.display()));
    };
    let base =
        std::fs::canonicalize(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    if !registry.is_authorized(&base) {
        return Err(outside(&base));
    }
    Ok(base.join(name))
}

/// Gate for a path that does not exist yet (create, or a rename/copy target).
/// Only the nearest existing ancestor can be canonicalized, so that is what
/// gets authorized; the missing tail is re-joined onto the real base. A tail
/// component can never be `..`, because `Path::file_name` refuses it.
pub fn authorized_new(
    registry: &WorkspaceRegistry,
    path: &str,
) -> Result<PathBuf, String> {
    let resolved = PathBuf::from(path);
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cursor = resolved.as_path();
    while !cursor.exists() {
        let (Some(name), Some(parent)) = (cursor.file_name(), cursor.parent()) else {
            return Err(format!("invalid path: {}", resolved.display()));
        };
        tail.push(name.to_os_string());
        cursor = parent;
    }
    let base =
        std::fs::canonicalize(cursor).map_err(|e| format!("{}: {e}", cursor.display()))?;
    if !registry.is_authorized(&base) {
        return Err(outside(&base));
    }
    let mut out = base;
    for name in tail.iter().rev() {
        out.push(name);
    }
    Ok(out)
}

/// The single canonical-to-display conversion. Backslashes are legal in Unix
/// filenames, so nothing is rewritten; route every conversion through here.
pub fn to_canon(p: impl AsRef<Path>) -> String {
    p.as_ref().to_string_lossy().into_owned()
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

    fn s(p: std::path::PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn reads_inside_an_authorized_root_are_allowed() {
        let (inside, _outside, reg) = fixture();
        let f = inside.path().join("a.txt");
        std::fs::write(&f, b"x").unwrap();
        assert!(authorized_read(&reg, &s(f)).is_ok());
    }

    #[test]
    fn every_gate_rejects_a_path_outside_all_roots() {
        let (_inside, outside, reg) = fixture();
        let f = outside.path().join("secret.txt");
        std::fs::write(&f, b"secret").unwrap();
        let p = s(f);
        for err in [
            authorized_read(&reg, &p).unwrap_err(),
            authorized_write(&reg, &p).unwrap_err(),
            authorized_entry(&reg, &p).unwrap_err(),
            authorized_new(&reg, &p).unwrap_err(),
        ] {
            assert!(err.contains("outside the authorized workspace"), "got: {err}");
        }
    }

    #[test]
    fn dot_dot_cannot_climb_out_of_an_authorized_root() {
        let (inside, outside, reg) = fixture();
        let escape = inside.path().join("..").join(
            outside
                .path()
                .file_name()
                .expect("tempdir has a final component"),
        );
        let err = authorized_read(&reg, &s(escape)).unwrap_err();
        assert!(err.contains("outside the authorized workspace"), "got: {err}");
    }

    // The gate canonicalizes, so a link planted inside the root cannot be used
    // to reach a file the root does not cover.
    #[test]
    fn a_symlink_pointing_outside_the_root_is_rejected() {
        let (inside, outside, reg) = fixture();
        let target = outside.path().join("secret.txt");
        std::fs::write(&target, b"secret").unwrap();
        let link = inside.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let err = authorized_read(&reg, &s(link)).unwrap_err();
        assert!(err.contains("outside the authorized workspace"), "got: {err}");
    }

    // Delete and rename act on the link itself, so this gate must authorize the
    // parent without resolving the final component.
    #[test]
    fn entry_gate_keeps_a_symlink_unresolved() {
        let (inside, outside, reg) = fixture();
        let target = outside.path().join("secret.txt");
        std::fs::write(&target, b"secret").unwrap();
        let link = inside.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let got = authorized_entry(&reg, &s(link.clone()))
            .expect("the link lives inside the root");
        assert_eq!(got.file_name(), link.file_name());
        assert!(
            got.symlink_metadata().unwrap().file_type().is_symlink(),
            "gate must not resolve the final component"
        );
    }

    #[test]
    fn new_paths_are_allowed_inside_and_refused_outside() {
        let (inside, outside, reg) = fixture();
        let ok = authorized_new(&reg, &s(inside.path().join("a/b/c.txt")))
            .expect("nested create under an authorized root");
        assert!(ok.starts_with(std::fs::canonicalize(inside.path()).unwrap()));

        assert!(
            authorized_new(&reg, &s(outside.path().join("x.txt"))).is_err()
        );
    }

    #[test]
    fn authorizing_a_single_file_does_not_authorize_its_siblings() {
        let (_inside, outside, reg) = fixture();
        let dropped = outside.path().join("dropped.txt");
        let sibling = outside.path().join("other.txt");
        std::fs::write(&dropped, b"ok").unwrap();
        std::fs::write(&sibling, b"no").unwrap();
        reg.authorize(&dropped).expect("authorize the dropped file");

        assert!(authorized_read(&reg, &s(dropped)).is_ok());
        assert!(authorized_read(&reg, &s(sibling)).is_err());
    }
}
