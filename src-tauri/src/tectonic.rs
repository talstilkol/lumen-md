//! LaTeX → PDF on the desktop with Tectonic (plan W5.22, step 3; W10.E14),
//! when the user has installed it. Lumen bundles no TeX: this finds a
//! `tectonic` binary (LUMEN_TECTONIC, then PATH, then the usual install
//! places), compiles the export's main.tex in a temporary folder with
//! `--untrusted` (no shell escape), and turns the TeX log into errors with
//! line numbers for the app to show.
//!
//! Network (R8-M1): Tectonic itself downloads its TeX support bundle and any
//! missing package from its bundle server on first use and on a cache miss.
//! With `offline` (airplane mode or the local-only policy, decided by the
//! page) it runs with `--only-cached`, so it makes no request and fails on a
//! package it has not cached. A compile is killed after `timeout` (a TeX file
//! that loops would otherwise hold the thread forever), and the work folder
//! is created fresh with mode 0700. Only `std`, so it is unit-tested without
//! the Tauri crates:
//!
//!   rustc --edition 2021 --test src-tauri/src/tectonic.rs -o /tmp/t && /tmp/t

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long one compile may run before it is killed (R8-M1).
pub const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);

/// Where to look for the binary, in order.
pub fn candidates(env_override: Option<&str>, path_var: Option<&str>) -> Vec<PathBuf> {
    let exe = if cfg!(windows) { "tectonic.exe" } else { "tectonic" };
    let mut out = Vec::new();
    if let Some(p) = env_override.filter(|p| !p.is_empty()) {
        out.push(PathBuf::from(p));
    }
    if let Some(paths) = path_var {
        for dir in std::env::split_paths(paths) {
            out.push(dir.join(exe));
        }
    }
    // A desktop app started from the Dock or Finder does not see the shell's PATH.
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        out.push(Path::new(dir).join(exe));
    }
    out
}

pub fn find(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// The command line: compile main.tex into `outdir`, keep the log, no shell escape;
/// `offline`: only the packages already cached, no download (R8-M1).
pub fn args(main: &Path, outdir: &Path, offline: bool) -> Vec<OsString> {
    let mut a: Vec<OsString> = vec![
        "-X".into(),
        "compile".into(),
        main.as_os_str().to_owned(),
        "--outdir".into(),
        outdir.as_os_str().to_owned(),
        "--keep-logs".into(),
        "--untrusted".into(),
    ];
    if offline {
        a.push("--only-cached".into());
    }
    a
}

/// The work folder: new (never one that already exists) and, on Unix, readable by this user only.
fn make_work_dir(work: &Path) -> std::io::Result<()> {
    let mut b = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(work)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TexError {
    /// The line in main.tex, when the log names one.
    pub line: Option<u32>,
    pub message: String,
}

/// The errors of a TeX log: `! message` followed by `l.<n> …`, and the
/// `error: main.tex:<n>: message` lines Tectonic prints itself.
pub fn parse_log(log: &str) -> Vec<TexError> {
    let mut out: Vec<TexError> = Vec::new();
    let lines: Vec<&str> = log.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let l = lines[i].trim_end();
        if let Some(msg) = l.strip_prefix("! ") {
            let mut line = None;
            for next in lines.iter().skip(i + 1).take(12) {
                if let Some(rest) = next.trim_start().strip_prefix("l.") {
                    line = rest.split(|c: char| !c.is_ascii_digit()).next().and_then(|n| n.parse().ok());
                    break;
                }
            }
            out.push(TexError { line, message: msg.trim().to_string() });
        } else if let Some(rest) = l.strip_prefix("error: ") {
            // error: main.tex:12: Undefined control sequence
            let mut parts = rest.splitn(3, ':');
            let (file, n, msg) = (parts.next(), parts.next(), parts.next());
            match (file, n.and_then(|n| n.trim().parse::<u32>().ok()), msg) {
                (Some(f), Some(n), Some(m)) if f.ends_with(".tex") => out.push(TexError { line: Some(n), message: m.trim().to_string() }),
                _ => out.push(TexError { line: None, message: rest.trim().to_string() }),
            }
        }
        i += 1;
    }
    // The same error reported by TeX and again by Tectonic counts once.
    let mut seen = std::collections::HashSet::new();
    out.retain(|e| seen.insert((e.line, e.message.clone())));
    out
}

/// A file of the export (an image, the .bib) by its relative name; nothing outside the folder.
pub fn safe_name(name: &str) -> bool {
    let p = Path::new(name);
    !name.is_empty() && name.len() <= 255 && p.components().all(|c| matches!(c, Component::Normal(_)))
}

#[derive(Debug)]
pub enum CompileError {
    /// The binary could not be started.
    Spawn(String),
    /// A file name that would leave the work folder.
    BadName(String),
    /// TeX failed: its errors, and the end of the log for anything they miss.
    Tex { errors: Vec<TexError>, log_tail: String },
    Io(String),
    /// Killed after this many seconds.
    Timeout(u64),
}

fn tail(s: &str, n: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    chars[chars.len().saturating_sub(n)..].iter().collect()
}

/// Compile `tex` (and its `files`) in `work`, which is created and removed. → the PDF bytes.
pub fn compile(bin: &Path, tex: &str, files: &[(String, Vec<u8>)], work: &Path, offline: bool, timeout: Duration) -> Result<Vec<u8>, CompileError> {
    for (name, _) in files {
        if !safe_name(name) {
            return Err(CompileError::BadName(name.clone()));
        }
    }
    make_work_dir(work).map_err(|e| CompileError::Io(e.to_string()))?;
    let run = (|| {
        let main = work.join("main.tex");
        std::fs::write(&main, tex).map_err(|e| CompileError::Io(e.to_string()))?;
        for (name, data) in files {
            let p = work.join(name);
            if let Some(dir) = p.parent() {
                std::fs::create_dir_all(dir).map_err(|e| CompileError::Io(e.to_string()))?;
            }
            std::fs::write(&p, data).map_err(|e| CompileError::Io(e.to_string()))?;
        }
        // Output to files in the work folder: no pipe to drain while the timeout is watched.
        let io = |name: &str| std::fs::File::create(work.join(name)).map_err(|e| CompileError::Io(e.to_string()));
        let mut child = Command::new(bin)
            .args(args(&main, work, offline))
            .current_dir(work)
            .stdin(Stdio::null())
            .stdout(io(".tectonic-stdout")?)
            .stderr(io(".tectonic-stderr")?)
            .spawn()
            .map_err(|e| CompileError::Spawn(e.to_string()))?;
        let started = Instant::now();
        let status = loop {
            match child.try_wait().map_err(|e| CompileError::Io(e.to_string()))? {
                Some(s) => break s,
                None if started.elapsed() >= timeout => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(CompileError::Timeout(timeout.as_secs()));
                }
                None => std::thread::sleep(Duration::from_millis(25)),
            }
        };
        let pdf = work.join("main.pdf");
        if status.success() && pdf.is_file() {
            return std::fs::read(&pdf).map_err(|e| CompileError::Io(e.to_string()));
        }
        let log = std::fs::read_to_string(work.join("main.log")).unwrap_or_default();
        let read = |name: &str| String::from_utf8_lossy(&std::fs::read(work.join(name)).unwrap_or_default()).into_owned();
        let printed = format!("{}{}", read(".tectonic-stdout"), read(".tectonic-stderr"));
        let mut errors = parse_log(&log);
        for e in parse_log(&printed) {
            if !errors.contains(&e) {
                errors.push(e);
            }
        }
        Err(CompileError::Tex { errors, log_tail: tail(if log.is_empty() { &printed } else { &log }, 1500) })
    })();
    let _ = std::fs::remove_dir_all(work);
    run
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("lumen-tectonic-test-{}-{}-{}", name, std::process::id(), stamp))
    }

    #[test]
    fn looks_in_the_override_then_path_then_install_places() {
        let c = candidates(Some("/x/tectonic"), Some("/a:/b"));
        let exe = if cfg!(windows) { "tectonic.exe" } else { "tectonic" };
        assert_eq!(c[0], PathBuf::from("/x/tectonic"));
        assert_eq!(c[1], Path::new("/a").join(exe));
        assert_eq!(c[2], Path::new("/b").join(exe));
        assert!(c.contains(&Path::new("/opt/homebrew/bin").join(exe)));
        assert!(candidates(Some(""), None).iter().all(|p| p.starts_with("/opt") || p.starts_with("/usr")));
        assert_eq!(find(&[PathBuf::from("/no/such/tectonic")]), None);
    }

    #[test]
    fn never_lets_tex_run_shell_commands() {
        let a: Vec<String> = args(Path::new("/w/main.tex"), Path::new("/w"), false).iter().map(|s| s.to_string_lossy().into_owned()).collect();
        assert_eq!(a, ["-X", "compile", "/w/main.tex", "--outdir", "/w", "--keep-logs", "--untrusted"]);
    }

    #[test]
    fn offline_compiles_from_the_cache_only() {
        let a: Vec<String> = args(Path::new("/w/main.tex"), Path::new("/w"), true).iter().map(|s| s.to_string_lossy().into_owned()).collect();
        assert_eq!(a, ["-X", "compile", "/w/main.tex", "--outdir", "/w", "--keep-logs", "--untrusted", "--only-cached"]);
    }

    // A TeX log of the usual shape (synthetic, written for this test).
    const LOG: &str = "This is XeTeX, Version 3.141592653\n(./main.tex\n! Undefined control sequence.\nl.7 \\foo\n         {bar}\n? \n! LaTeX Error: File `missing.sty' not found.\n\nType X to quit or <RETURN> to proceed,\nl.3 \\usepackage\n          {missing}^^M\n)\n";

    #[test]
    fn reads_errors_and_their_lines_from_the_log() {
        assert_eq!(
            parse_log(LOG),
            vec![
                TexError { line: Some(7), message: "Undefined control sequence.".into() },
                TexError { line: Some(3), message: "LaTeX Error: File `missing.sty' not found.".into() },
            ]
        );
        assert_eq!(parse_log("error: main.tex:12: Undefined control sequence\nerror: halted on potentially-recoverable error as specified\n"), vec![
            TexError { line: Some(12), message: "Undefined control sequence".into() },
            TexError { line: None, message: "halted on potentially-recoverable error as specified".into() },
        ]);
        assert_eq!(parse_log("! Emergency stop.\n"), vec![TexError { line: None, message: "Emergency stop.".into() }]);
    }

    #[test]
    fn refuses_a_file_name_outside_the_folder() {
        assert!(safe_name("images/a.png") && safe_name("refs.bib"));
        assert!(!safe_name("../x") && !safe_name("/etc/passwd") && !safe_name("") && !safe_name("a/../../b"));
        let bin = PathBuf::from("/bin/true");
        match compile(&bin, "x", &[("../evil".into(), vec![])], &tmp("bad"), false, COMPILE_TIMEOUT) {
            Err(CompileError::BadName(n)) => assert_eq!(n, "../evil"),
            r => panic!("{:?}", r.map(|_| ())),
        }
    }

    #[cfg(unix)]
    fn fake_tectonic(dir: &Path, script: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join("tectonic");
        std::fs::write(&p, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    #[test]
    fn compiles_with_a_stand_in_binary_and_cleans_up() {
        let bins = tmp("bin-ok");
        // A stand-in for tectonic: checks its arguments and the input files, writes main.pdf where --outdir says.
        let bin = fake_tectonic(&bins, r#"[ "$1" = -X ] && [ "$2" = compile ] && [ "$4" = --outdir ] && [ "$7" = --untrusted ] || exit 9
grep -q 'שלום' "$3" || exit 8
[ -f "$5/images/a.png" ] || exit 7
printf '%%PDF-1.7 stand-in' > "$5/main.pdf""#);
        let work = tmp("work-ok");
        let pdf = compile(&bin, "\\documentclass{article}\\begin{document}שלום\\end{document}", &[("images/a.png".into(), vec![0x89, 0x50])], &work, false, COMPILE_TIMEOUT).expect("compiled");
        assert_eq!(pdf, b"%PDF-1.7 stand-in");
        assert!(!work.exists(), "the work folder is removed");
        let _ = std::fs::remove_dir_all(&bins);
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_compile_gives_the_errors_with_lines() {
        let bins = tmp("bin-fail");
        let bin = fake_tectonic(&bins, &format!("cat > \"$5/main.log\" <<'EOF'\n{LOG}EOF\necho 'error: main.tex:7: Undefined control sequence.' >&2\nexit 1"));
        let work = tmp("work-fail");
        match compile(&bin, "x", &[], &work, false, COMPILE_TIMEOUT) {
            Err(CompileError::Tex { errors, log_tail }) => {
                assert_eq!(errors[0], TexError { line: Some(7), message: "Undefined control sequence.".into() });
                assert_eq!(errors.len(), 2, "TeX's and Tectonic's report of the same error count once: {errors:?}");
                assert!(log_tail.contains("missing.sty"));
            }
            r => panic!("{:?}", r.map(|_| ())),
        }
        assert!(!work.exists());
        let _ = std::fs::remove_dir_all(&bins);
    }

    #[cfg(unix)]
    #[test]
    fn offline_passes_only_cached_to_the_binary() {
        let bins = tmp("bin-offline");
        let bin = fake_tectonic(&bins, r#"[ "$8" = --only-cached ] || exit 9
printf '%%PDF-1.7 cached' > "$5/main.pdf""#);
        let pdf = compile(&bin, "x", &[], &tmp("work-offline"), true, COMPILE_TIMEOUT).expect("compiled from the cache");
        assert_eq!(pdf, b"%PDF-1.7 cached");
        let _ = std::fs::remove_dir_all(&bins);
    }

    #[cfg(unix)]
    #[test]
    fn a_compile_that_never_ends_is_killed_and_cleaned_up() {
        let bins = tmp("bin-loop");
        let bin = fake_tectonic(&bins, "sleep 30");
        let work = tmp("work-loop");
        let started = std::time::Instant::now();
        match compile(&bin, "x", &[], &work, false, Duration::from_millis(300)) {
            Err(CompileError::Timeout(_)) => {}
            r => panic!("{:?}", r.map(|_| ())),
        }
        assert!(started.elapsed() < Duration::from_secs(10), "killed, not waited for");
        assert!(!work.exists());
        let _ = std::fs::remove_dir_all(&bins);
    }

    #[cfg(unix)]
    #[test]
    fn the_work_folder_is_private_and_never_reused() {
        use std::os::unix::fs::PermissionsExt;
        let bins = tmp("bin-mode");
        // The stand-in reports its folder's mode in the "PDF".
        let bin = fake_tectonic(&bins, r#"stat -c %a "$5" > "$5/main.pdf" 2>/dev/null || stat -f %Lp "$5" > "$5/main.pdf""#);
        let pdf = compile(&bin, "x", &[], &tmp("work-mode"), false, COMPILE_TIMEOUT).expect("compiled");
        assert_eq!(String::from_utf8_lossy(&pdf).trim(), "700");
        // An existing folder (a planted one, say) is refused, not written into.
        let planted = tmp("work-planted");
        std::fs::create_dir_all(&planted).unwrap();
        std::fs::set_permissions(&planted, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert!(matches!(compile(&bin, "x", &[], &planted, false, COMPILE_TIMEOUT), Err(CompileError::Io(_))));
        let _ = std::fs::remove_dir_all(&planted);
        let _ = std::fs::remove_dir_all(&bins);
    }

    #[test]
    fn a_missing_binary_is_a_spawn_error() {
        match compile(Path::new("/no/such/tectonic"), "x", &[], &tmp("spawn"), false, COMPILE_TIMEOUT) {
            Err(CompileError::Spawn(_)) => {}
            r => panic!("{:?}", r.map(|_| ())),
        }
    }
}
