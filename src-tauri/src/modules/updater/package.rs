use std::path::Path;
use std::process::{Command, Stdio};


#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageKind {
    Rpm,
    Deb,
    Unsupported,
}

/// The decision, split out from the probing so it is testable without a real
/// install. `rpm` is checked before `dpkg` because a machine with both tools
/// installed is almost always an rpm distro that happens to ship dpkg.
///
/// A missing `pkexec` is reported as `Unsupported` here rather than failing at
/// install time, so the UI can offer the manual link instead of a download it
/// could never finish.
pub fn classify(
    appimage: Option<&str>,
    pkexec: bool,
    rpm_owns: bool,
    dpkg_owns: bool,
) -> PackageKind {
    if appimage.is_some() || !pkexec {
        return PackageKind::Unsupported;
    }
    if rpm_owns {
        return PackageKind::Rpm;
    }
    if dpkg_owns {
        return PackageKind::Deb;
    }
    PackageKind::Unsupported
}

/// Probes the environment and the running binary's ownership, then classifies.
pub fn detect() -> PackageKind {
    let appimage = std::env::var("APPIMAGE").ok();
    let exe = match std::env::current_exe().and_then(|p| p.canonicalize()) {
        Ok(p) => p,
        Err(_) => return PackageKind::Unsupported,
    };
    classify(
        appimage.as_deref(),
        which::which("pkexec").is_ok(),
        owns(&["rpm", "-qf"], &exe),
        owns(&["dpkg", "-S"], &exe),
    )
}

fn owns(argv: &[&str], exe: &Path) -> bool {
    let Some((bin, args)) = argv.split_first() else {
        return false;
    };
    if which::which(bin).is_err() {
        return false;
    }
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .arg(exe)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

/// `dnf`/`apt-get` rather than `rpm -U`/`dpkg -i`: the higher-level tools
/// resolve dependencies, which matters when a release bumps libwebkit2gtk.
pub fn install_command(kind: PackageKind, path: &Path) -> Option<(String, Vec<String>)> {
    let p = path.to_string_lossy().into_owned();
    let args = match kind {
        PackageKind::Rpm => vec!["dnf".into(), "install".into(), "-y".into(), p],
        PackageKind::Deb => vec!["apt-get".into(), "install".into(), "-y".into(), p],
        PackageKind::Unsupported => return None,
    };
    Some(("pkexec".into(), args))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn appimage_is_unsupported_even_when_a_package_owns_the_binary() {
        // An AppImage extracted next to a distro install must never be
        // "upgraded" by handing the distro package manager a new file.
        assert_eq!(
            classify(Some("/home/u/Terra.AppImage"), true, true, false),
            PackageKind::Unsupported
        );
    }

    #[test]
    fn missing_pkexec_is_unsupported() {
        // Without a way to escalate there is no in-place install, so the UI
        // must fall back to the manual link rather than offering a download
        // it cannot finish.
        assert_eq!(classify(None, false, true, false), PackageKind::Unsupported);
    }

    #[test]
    fn rpm_ownership_wins() {
        assert_eq!(classify(None, true, true, false), PackageKind::Rpm);
    }

    #[test]
    fn dpkg_ownership_wins() {
        assert_eq!(classify(None, true, false, true), PackageKind::Deb);
    }

    #[test]
    fn rpm_takes_precedence_when_both_claim_the_binary() {
        // Some systems have both tools installed; rpm is probed first.
        assert_eq!(classify(None, true, true, true), PackageKind::Rpm);
    }

    #[test]
    fn unowned_binary_is_unsupported() {
        assert_eq!(classify(None, true, false, false), PackageKind::Unsupported);
    }

    #[test]
    fn rpm_install_uses_dnf_with_an_absolute_path() {
        let (bin, args) =
            install_command(PackageKind::Rpm, Path::new("/tmp/u/Terra.rpm")).unwrap();
        assert_eq!(bin, "pkexec");
        assert_eq!(args, vec!["dnf", "install", "-y", "/tmp/u/Terra.rpm"]);
    }

    #[test]
    fn deb_install_uses_apt_get_with_an_absolute_path() {
        let (bin, args) =
            install_command(PackageKind::Deb, Path::new("/tmp/u/Terra.deb")).unwrap();
        assert_eq!(bin, "pkexec");
        assert_eq!(args, vec!["apt-get", "install", "-y", "/tmp/u/Terra.deb"]);
    }

    #[test]
    fn unsupported_has_no_install_command() {
        assert!(install_command(PackageKind::Unsupported, Path::new("/tmp/x")).is_none());
    }
}
