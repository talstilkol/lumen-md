//! Review 11 regressions (M1, L2): an interpreter given only options still reads its program from
//! stdin; an option's separate value is not the program; the launchers that run a command; the
//! app's backups folder and non-canonical roots; the bound on a file that reports a smaller size.

use crate::allowlist::sha256_file_within;
use crate::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

static N: AtomicUsize = AtomicUsize::new(0);

fn dir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("lumen-rev11-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(d).unwrap()
}

fn sp(cmd: &str, args: &[&str]) -> Spec {
    Spec { command: cmd.into(), args: args.iter().map(|s| s.to_string()).collect(), cwd: None }
}

/// A program of our own (a copy of `touch`) under `name`: pinning hashes it, nothing runs.
#[cfg(unix)]
fn own(d: &Path, name: &str) -> String {
    let src = ["/usr/bin/touch", "/bin/touch"].iter().find(|p| Path::new(p).is_file()).expect("touch");
    let dst = d.join(name);
    std::fs::copy(src, &dst).unwrap();
    dst.to_string_lossy().into_owned()
}

#[test]
fn m1_an_interpreter_with_only_options_reads_stdin_and_is_refused() {
    for (cmd, args) in [
        ("/usr/bin/python3", &["-u"][..]),
        ("/usr/bin/python3", &["-W", "ignore"]),
        ("/usr/bin/python3", &["-X", "dev", "-u"]),
        ("/usr/bin/python3", &["-m"]),
        ("/usr/bin/node", &["--no-warnings"]),
        ("/usr/bin/node", &["-r", "/abs/pre.js"]),
        ("/usr/bin/node", &["--import", "/abs/pre.mjs"]),
        ("node", &["-C", "dev"]),
        ("deno", &["run", "--config", "deno.json"]),
        ("bun", &["--preload", "x.ts"]),
        ("ruby", &["-r", "json"]),
        ("php", &["-f"]),
        ("perl", &["-I", "lib"]),
    ] {
        let e = sp(cmd, args).validate().unwrap_err();
        assert!(e.contains("reads its code from stdin"), "{cmd} {args:?}: {e}");
    }
    // A script or module after the options still runs.
    for (cmd, args) in [
        ("/usr/bin/python3", &["-u", "server.py"][..]),
        ("/usr/bin/python3", &["-W", "ignore", "server.py"]),
        ("/usr/bin/python3", &["-m", "srv"]),
        ("/usr/bin/python3", &["-mcalendar"]),
        ("/usr/bin/python3", &["-um", "srv"]),
        ("/usr/bin/node", &["--no-warnings", "s.js"]),
        ("/usr/bin/node", &["-r", "/abs/pre.js", "s.js"]),
        ("/usr/bin/node", &["--require=/abs/pre.js", "s.js"]),
        ("deno", &["run", "--allow-read", "server.ts"]),
        ("php", &["-f", "s.php"]),
    ] {
        assert!(sp(cmd, args).validate().is_ok(), "{cmd} {args:?}");
    }
}

#[test]
fn m1_an_options_separate_value_is_not_the_program() {
    let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(allowlist::program_position("python", &v(&["-W", "ignore", "dir"])), 2);
    assert_eq!(allowlist::program_position("python", &v(&["-X", "dev", "dir"])), 2);
    assert_eq!(allowlist::program_position("python", &v(&["-uW", "ignore", "dir"])), 2);
    assert_eq!(allowlist::program_position("python", &v(&["-Wignore", "dir"])), 1);
    assert_eq!(allowlist::program_position("python", &v(&["-m", "mod", "dir"])), 1);
    assert_eq!(allowlist::program_position("node", &v(&["-r", "pre.js", "dir"])), 2);
    assert_eq!(allowlist::program_position("node", &v(&["--import", "pre.mjs", "dir"])), 2);
    assert_eq!(allowlist::program_position("node", &v(&["--no-warnings", "s.js"])), 1);
    assert_eq!(allowlist::program_position("deno", &v(&["run", "--config", "d.json", "s.ts"])), 3);
    assert_eq!(allowlist::program_position("node", &v(&["--no-warnings"])), 1);
}

#[cfg(unix)]
#[test]
fn m1_a_folder_after_an_options_separate_value_is_refused() {
    let d = dir();
    let pkg = d.join("pkg");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::write(pkg.join("__main__.py"), b"v1").unwrap();
    std::fs::write(d.join("pre.js"), b"x").unwrap();
    let py = own(&d, "python3");
    let node = own(&d, "node");
    let p = pkg.to_str().unwrap();
    let pre = d.join("pre.js");
    let pre = pre.to_str().unwrap();
    for (prog, args) in [(&py, vec!["-W", "ignore", p]), (&py, vec!["-X", "dev", p]), (&py, vec!["-m", "pkg"]), (&node, vec!["-r", pre, p]), (&node, vec!["-r", p, "s.js"])] {
        let e = pin(&Spec { command: prog.clone(), args: args.iter().map(|s| s.to_string()).collect(), cwd: Some(d.to_string_lossy().into_owned()) }, None).unwrap_err();
        assert!(e.contains("is a folder where"), "{prog} {args:?}: {e}");
    }
    // After the script the folder is data.
    std::fs::write(d.join("s.py"), b"x").unwrap();
    let ok = pin(&Spec { command: py.clone(), args: vec!["-W".into(), "ignore".into(), "s.py".into(), p.into()], cwd: Some(d.to_string_lossy().into_owned()) }, None).unwrap();
    assert_eq!(ok.folders, vec![3]);
}

#[test]
fn l2_launchers_that_run_a_command_are_refused() {
    for name in ["nohup", "timeout", "nice", "xargs", "awk", "/usr/bin/gawk", "stdbuf", "setsid", "sudo"] {
        let e = sp(name, &["/usr/bin/mcp-server", "x"]).validate().unwrap_err();
        assert!(e.contains("shell or launcher"), "{name}: {e}");
    }
}

#[cfg(unix)]
#[test]
fn l2_the_backups_folder_and_a_symlinked_root_are_page_writable() {
    let d = dir();
    let data = d.join("appdata");
    std::fs::create_dir_all(data.join("backups")).unwrap();
    std::fs::create_dir_all(d.join("real")).unwrap();
    std::os::unix::fs::symlink(d.join("real"), d.join("link")).unwrap();
    let roots = page_writable_roots(&[d.join("link").to_string_lossy().into_owned()], Some(&data));
    assert!(roots.contains(&d.join("real").to_string_lossy().into_owned()), "{roots:?}");
    assert!(roots.contains(&data.join("backups").to_string_lossy().into_owned()), "{roots:?}");
    let prog = own(&data.join("backups"), "mcp-server");
    let e = pin_in(&sp(&prog, &[]), None, &roots).unwrap_err();
    assert!(e.contains("inside the vault"), "{e}");
    std::fs::write(d.join("real/s.py"), b"x").unwrap();
    let py = own(&d, "python3");
    let e = pin_in(&sp(&py, &[d.join("real/s.py").to_str().unwrap()]), None, &roots).unwrap_err();
    assert!(e.contains("inside the vault"), "{e}");
}

#[test]
fn l2_the_mcp_glue_passes_the_backups_folder() {
    let glue = include_str!("../../src/mcp_stdio.rs");
    let body = &glue[glue.find("fn vaults(").expect("vaults()")..];
    let body = &body[..body.find("\n}\n").unwrap()];
    assert!(body.contains("page_writable_roots(") && body.contains("app_data_dir()"), "{body}");
}

/// A file whose size the file system reports smaller than what it reads (here a /proc file,
/// which reports 0) stops at the bound: the check on the bytes read, not only on the size.
#[cfg(target_os = "linux")]
#[test]
fn l2_a_file_that_reads_more_than_its_size_stops_at_the_bound() {
    let p = Path::new("/proc/self/status");
    assert_eq!(std::fs::metadata(p).unwrap().len(), 0);
    assert!(sha256_file_within(p, 1 << 20).is_ok());
    let e = sha256_file_within(p, 16).unwrap_err();
    assert!(e.contains("is not pinned"), "{e}");
}
