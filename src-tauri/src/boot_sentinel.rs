//! The desktop boot sentinel and local rollback (plan W13.T1).
//!
//! Every launch writes "boot in progress" for the running version into the
//! app data folder (`boot-sentinel`); the WebView's first `shell_ready`
//! from the main window clears it (the bundle loaded, React mounted the app
//! and its effects ran). A launch that finds the marker of the same version
//! still set counts a failed start. After two failed starts of a version
//! that is not the last one that started cleanly, the next launch restores
//! the copy of that last good version which the shell kept when it installed
//! the update (`rollback/`), before any window opens, and relaunches it.
//!
//! The anti-downgrade rule (W10.D9, W11.S2) is untouched: a manifest can
//! still never offer an older build, and `highest-installed-version` still
//! holds the broken one, so it is not offered again; only a newer, fixed
//! version is. Going back is a local act, from a local copy.
//!
//! What is copied, per platform: the AppImage file (Linux, `$APPIMAGE`), the
//! `.app` bundle (macOS), the install folder (Windows). A system package
//! (.deb, .rpm) belongs to the package manager: no copy, no rollback, and
//! the notice says so. Restoring renames each current file aside first
//! (a running executable can be renamed on all three), then copies the kept
//! one in, so a failed restore leaves the files where they were.
//!
//! Std only, so `rustc --test src/boot_sentinel.rs` runs it on its own.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const STATE_FILE: &str = "boot-sentinel";
pub const ROLLBACK_DIR: &str = "rollback";
/// What the rollback folder keeps besides the copy: the version it is.
pub const ROLLBACK_VERSION: &str = "version";
pub const ROLLBACK_PAYLOAD: &str = "payload";
/// Failed starts in a row after which the last good version comes back.
pub const FAILURES_BEFORE_ROLLBACK: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct State {
    pub version: String,
    pub pending: bool,
    pub failures: u32,
    pub good: Option<String>,
    /// Set by a rollback, for the notice: (from, to).
    pub rolled_back: Option<(String, String)>,
}

impl State {
    pub fn parse(text: &str) -> State {
        let mut s = State::default();
        for line in text.lines() {
            let Some((k, v)) = line.split_once('=') else { continue };
            let v = v.trim();
            match k.trim() {
                "version" => s.version = v.to_string(),
                "pending" => s.pending = v == "1",
                "failures" => s.failures = v.parse().unwrap_or(0).min(99),
                "good" if !v.is_empty() => s.good = Some(v.to_string()),
                "rolled_back" => {
                    if let Some((a, b)) = v.split_once("->") {
                        s.rolled_back = Some((a.to_string(), b.to_string()));
                    }
                }
                _ => {}
            }
        }
        s
    }

    pub fn serialize(&self) -> String {
        let mut out = format!("version={}\npending={}\nfailures={}\ngood={}\n", self.version, if self.pending { 1 } else { 0 }, self.failures, self.good.as_deref().unwrap_or(""));
        if let Some((a, b)) = &self.rolled_back {
            out.push_str(&format!("rolled_back={a}->{b}\n"));
        }
        out
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    /// Start normally.
    Start,
    /// Restore the kept copy of this version, then relaunch.
    Rollback { to: String },
    /// Two failed starts, but nothing to go back to (no copy, or it is this version).
    NoRollback { reason: &'static str },
}

/// The state this launch writes and what it does, from the last state.
/// `kept`: the version of the copy in `rollback/`, if there is one.
pub fn on_launch(prev: Option<&State>, current: &str, kept: Option<&str>) -> (State, Action) {
    let mut good = prev.and_then(|p| p.good.clone());
    let failures = match prev {
        Some(p) if p.version == current => {
            if p.pending {
                p.failures + 1
            } else {
                0
            }
        }
        Some(p) => {
            if !p.pending {
                good = Some(p.version.clone());
            }
            0
        }
        None => 0,
    };
    let next = State { version: current.to_string(), pending: true, failures, good: good.clone(), rolled_back: None };
    if failures < FAILURES_BEFORE_ROLLBACK {
        return (next, Action::Start);
    }
    let action = match (good.as_deref(), kept) {
        (Some(g), Some(k)) if g != current && k == g => Action::Rollback { to: g.to_string() },
        (_, None) => Action::NoRollback { reason: "no copy of the previous version was kept (a system package, or the first install)" },
        _ => Action::NoRollback { reason: "the kept copy is not the last version that started" },
    };
    (next, action)
}

/// The start finished (`shell_ready` from the main window).
pub fn on_ready(prev: Option<&State>, current: &str) -> State {
    State { version: current.to_string(), pending: false, failures: 0, good: Some(current.to_string()), rolled_back: prev.and_then(|p| p.rolled_back.clone()) }
}

/// What to copy before an update replaces this build: the AppImage, the
/// `.app` bundle or the install folder; None for a system package.
pub fn install_root(exe: &Path, appimage: Option<&Path>, os: &str) -> Option<PathBuf> {
    match os {
        "linux" => appimage.map(Path::to_path_buf),
        "macos" => {
            // …/Lumen.app/Contents/MacOS/lumen
            let app = exe.parent()?.parent()?.parent()?;
            app.extension().is_some_and(|e| e == "app").then(|| app.to_path_buf())
        }
        "windows" => {
            let dir = exe.parent()?;
            // A per-user or per-machine NSIS/MSI install, never a folder we cannot own.
            let s = dir.to_string_lossy().to_lowercase();
            (s.contains("\\programs\\") || s.contains("\\program files")).then(|| dir.to_path_buf())
        }
        _ => None,
    }
}

fn copy_tree(from: &Path, to: &Path) -> io::Result<u64> {
    let meta = fs::symlink_metadata(from)?;
    if meta.is_dir() {
        fs::create_dir_all(to)?;
        let mut n = 0;
        for e in fs::read_dir(from)? {
            let e = e?;
            n += copy_tree(&e.path(), &to.join(e.file_name()))?;
        }
        Ok(n)
    } else if meta.file_type().is_symlink() {
        #[cfg(unix)]
        {
            let target = fs::read_link(from)?;
            let _ = fs::remove_file(to);
            std::os::unix::fs::symlink(target, to)?;
        }
        Ok(0)
    } else {
        if let Some(p) = to.parent() {
            fs::create_dir_all(p)?;
        }
        fs::copy(from, to)
    }
}

/// Keep a copy of the running build (version `version`) before an update
/// replaces it; one copy only. Written to a temporary folder first, so a
/// half-made copy is never taken for a whole one.
pub fn keep_copy(data_dir: &Path, root: &Path, version: &str) -> io::Result<u64> {
    let dir = data_dir.join(ROLLBACK_DIR);
    let tmp = data_dir.join(format!("{ROLLBACK_DIR}.tmp"));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp)?;
    let name = root.file_name().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "install root has no name"))?;
    let bytes = copy_tree(root, &tmp.join(ROLLBACK_PAYLOAD).join(name))?;
    fs::write(tmp.join(ROLLBACK_VERSION), version)?;
    fs::write(tmp.join("root"), root.to_string_lossy().as_bytes())?;
    let _ = fs::remove_dir_all(&dir);
    fs::rename(&tmp, &dir)?;
    Ok(bytes)
}

/// The version of the kept copy, if a whole one is there.
pub fn kept_version(data_dir: &Path) -> Option<String> {
    let dir = data_dir.join(ROLLBACK_DIR);
    let v = fs::read_to_string(dir.join(ROLLBACK_VERSION)).ok()?;
    fs::metadata(dir.join("root")).ok()?;
    Some(v.trim().to_string())
}

fn files_under(root: &Path, rel: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    // why: joining an empty path adds a trailing separator, which a plain file refuses
    let p = if rel.as_os_str().is_empty() { root.to_path_buf() } else { root.join(rel) };
    if fs::symlink_metadata(&p)?.is_dir() {
        for e in fs::read_dir(&p)? {
            files_under(root, &rel.join(e?.file_name()), out)?;
        }
    } else {
        out.push(rel.to_path_buf());
    }
    Ok(())
}

/// Put the kept copy back over the install root it came from. Each current
/// file is renamed to `<name>.lumen-old` first; if any copy fails, every
/// renamed file is put back. Returns the root (to relaunch from).
pub fn restore(data_dir: &Path) -> io::Result<PathBuf> {
    let dir = data_dir.join(ROLLBACK_DIR);
    let root = PathBuf::from(fs::read_to_string(dir.join("root"))?.trim());
    let name = root.file_name().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "kept root has no name"))?;
    let payload = dir.join(ROLLBACK_PAYLOAD).join(name);
    let mut files = Vec::new();
    files_under(&payload, Path::new(""), &mut files)?;
    let single = files.len() == 1 && files[0].as_os_str().is_empty();
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    let result = (|| -> io::Result<()> {
        for rel in &files {
            let (src, dst) = if single { (payload.clone(), root.clone()) } else { (payload.join(rel), root.join(rel)) };
            if dst.exists() {
                let aside = PathBuf::from(format!("{}.lumen-old", dst.to_string_lossy()));
                let _ = fs::remove_file(&aside);
                fs::rename(&dst, &aside)?;
                moved.push((dst.clone(), aside));
            }
            copy_tree(&src, &dst)?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            // The old files are no longer needed (a running one is removed on the next launch).
            for (_, aside) in &moved {
                let _ = fs::remove_file(aside);
            }
            Ok(root)
        }
        Err(e) => {
            for (dst, aside) in moved.iter().rev() {
                let _ = fs::remove_file(dst);
                let _ = fs::rename(aside, dst);
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(version: &str, pending: bool, failures: u32, good: Option<&str>) -> State {
        State { version: version.into(), pending, failures, good: good.map(Into::into), rolled_back: None }
    }

    #[test]
    fn state_round_trips_and_ignores_junk() {
        let s = State { version: "1.5.0".into(), pending: true, failures: 2, good: Some("1.4.2".into()), rolled_back: Some(("1.5.0".into(), "1.4.2".into())) };
        assert_eq!(State::parse(&s.serialize()), s);
        assert_eq!(State::parse("garbage\nfailures=x\n"), State::default());
    }

    #[test]
    fn two_failed_starts_bring_back_the_last_good_version() {
        // 1.4.2 ran fine; 1.5.0 was installed (copy of 1.4.2 kept).
        let s0 = on_ready(None, "1.4.2");
        let (s1, a1) = on_launch(Some(&s0), "1.5.0", Some("1.4.2"));
        assert_eq!(a1, Action::Start);
        assert_eq!(s1.good.as_deref(), Some("1.4.2"));
        // It never reached shell_ready: first failure.
        let (s2, a2) = on_launch(Some(&s1), "1.5.0", Some("1.4.2"));
        assert_eq!((s2.failures, a2), (1, Action::Start));
        // Second failure: roll back.
        let (s3, a3) = on_launch(Some(&s2), "1.5.0", Some("1.4.2"));
        assert_eq!(s3.failures, 2);
        assert_eq!(a3, Action::Rollback { to: "1.4.2".into() });
    }

    #[test]
    fn a_start_that_finishes_resets_the_count() {
        let (s1, _) = on_launch(Some(&st("1.5.0", true, 1, Some("1.4.2"))), "1.5.0", Some("1.4.2"));
        let ok = on_ready(Some(&s1), "1.5.0");
        let (s2, a) = on_launch(Some(&ok), "1.5.0", Some("1.4.2"));
        assert_eq!((s2.failures, a), (0, Action::Start));
        assert_eq!(s2.good.as_deref(), Some("1.5.0"));
    }

    #[test]
    fn no_copy_or_the_wrong_copy_means_no_rollback() {
        let prev = st("1.5.0", true, 1, Some("1.4.2"));
        assert!(matches!(on_launch(Some(&prev), "1.5.0", None).1, Action::NoRollback { .. }));
        assert!(matches!(on_launch(Some(&prev), "1.5.0", Some("1.3.0")).1, Action::NoRollback { .. }));
        // The last good version is this one (it broke later, e.g. a plugin): nothing to go back to.
        let same = st("1.5.0", true, 3, Some("1.5.0"));
        assert!(matches!(on_launch(Some(&same), "1.5.0", Some("1.5.0")).1, Action::NoRollback { .. }));
    }

    #[test]
    fn install_roots() {
        assert_eq!(install_root(Path::new("/Applications/Lumen.app/Contents/MacOS/lumen"), None, "macos"), Some(PathBuf::from("/Applications/Lumen.app")));
        assert_eq!(install_root(Path::new("/usr/local/bin/lumen"), None, "macos"), None);
        assert_eq!(install_root(Path::new("/usr/bin/lumen"), None, "linux"), None);
        assert_eq!(install_root(Path::new("/tmp/.mount_x/usr/bin/lumen"), Some(Path::new("/home/u/Lumen.AppImage")), "linux"), Some(PathBuf::from("/home/u/Lumen.AppImage")));
        assert!(install_root(Path::new("C:\\Users\\u\\AppData\\Local\\Programs\\Lumen\\lumen.exe"), None, "windows").is_some() || cfg!(not(windows)));
    }

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("lumen-boot-sentinel-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn keep_and_restore_a_bundle_folder() {
        let base = tmp("bundle");
        let data = base.join("data");
        let app = base.join("Lumen.app");
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/MacOS/lumen"), "1.4.2 binary").unwrap();
        fs::write(app.join("Contents/Info.plist"), "1.4.2 plist").unwrap();
        keep_copy(&data, &app, "1.4.2").unwrap();
        assert_eq!(kept_version(&data).as_deref(), Some("1.4.2"));
        // The update replaces the bundle.
        fs::write(app.join("Contents/MacOS/lumen"), "1.5.0 broken").unwrap();
        fs::write(app.join("Contents/Info.plist"), "1.5.0 plist").unwrap();
        let root = restore(&data).unwrap();
        assert_eq!(root, app);
        assert_eq!(fs::read_to_string(app.join("Contents/MacOS/lumen")).unwrap(), "1.4.2 binary");
        assert_eq!(fs::read_to_string(app.join("Contents/Info.plist")).unwrap(), "1.4.2 plist");
        assert!(!app.join("Contents/MacOS/lumen.lumen-old").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn keep_and_restore_a_single_appimage() {
        let base = tmp("appimage");
        let data = base.join("data");
        let file = base.join("Lumen.AppImage");
        fs::write(&file, "old").unwrap();
        keep_copy(&data, &file, "1.4.2").unwrap();
        fs::write(&file, "new broken").unwrap();
        restore(&data).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "old");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_half_made_copy_is_not_a_copy() {
        let base = tmp("half");
        let data = base.join("data");
        fs::create_dir_all(data.join(ROLLBACK_DIR)).unwrap();
        fs::write(data.join(ROLLBACK_DIR).join(ROLLBACK_VERSION), "1.4.2").unwrap();
        assert_eq!(kept_version(&data), None);
        assert!(restore(&data).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
