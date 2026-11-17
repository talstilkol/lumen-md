//! The Pandoc bridge on the desktop (plan W13.F5): formats Lumen has no
//! importer of its own for (DocBook, MediaWiki, Jira, OPML, txt2tags and the
//! rest of Pandoc's readers) are converted by the `pandoc` the user installed.
//!
//! Lumen bundles no Pandoc (GPL-2.0-or-later): this finds the user's binary
//! (LUMEN_PANDOC, then PATH, then the usual install places) and runs it with a
//! fixed argument list — never through a shell, never with an argument the
//! page wrote except the reader's name, which must be one Pandoc itself listed
//! (`--list-input-formats`) and look like a format name:
//!
//!   pandoc --sandbox -f <reader> -t gfm --wrap=preserve -o <work>/out.md <work>/in.<ext>
//!
//! `--sandbox` (Pandoc ≥ 2.15) keeps the reader from opening any other file or
//! the network: the conversion reads `in.<ext>` and writes `out.md`, nothing
//! else. The work folder is fresh and 0700, and is removed afterwards; a run
//! is killed after `CONVERT_TIMEOUT`. Every run is listed in the privacy
//! ledger by the page, as a local process. Only `std`, so it is unit-tested
//! without the Tauri crates:
//!
//!   rustc --edition 2021 --test src-tauri/src/pandoc.rs -o /tmp/p && /tmp/p
//!
//! The Tauri commands (`pandoc_status`, `pandoc_convert`) are owed: a new
//! command must be added to the isolation app's allow-list
//! (src-tauri/isolation/index.js), which this lane may not touch.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long one conversion may run before it is killed.
pub const CONVERT_TIMEOUT: Duration = Duration::from_secs(60);
/// The largest input converted (a reader that is fed a huge file would take minutes).
pub const MAX_INPUT: usize = 50 * 1024 * 1024;
/// `--sandbox` arrived in Pandoc 2.15.
pub const MIN_VERSION: (u32, u32) = (2, 15);

#[derive(Debug, PartialEq)]
pub enum PandocError {
    /// No pandoc found.
    Missing,
    /// Older than 2.15 (no --sandbox): refused rather than run without it.
    TooOld(String),
    /// The reader is not one this pandoc lists, or not a format name.
    BadFormat(String),
    TooLarge(usize),
    Spawn(String),
    Io(String),
    /// Pandoc failed: its exit code and the end of its stderr.
    Failed { code: Option<i32>, stderr: String },
    Timeout(u64),
}

/// The places to look, in order: LUMEN_PANDOC, every PATH entry, the usual install folders.
pub fn candidates(env: Option<&str>, path: Option<&str>) -> Vec<PathBuf> {
    let exe = if cfg!(windows) { "pandoc.exe" } else { "pandoc" };
    let mut out = Vec::new();
    if let Some(e) = env.filter(|e| !e.trim().is_empty()) {
        out.push(PathBuf::from(e.trim()));
    }
    if let Some(p) = path {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in p.split(sep).filter(|d| !d.is_empty()) {
            out.push(Path::new(dir).join(exe));
        }
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        out.push(Path::new(dir).join(exe));
    }
    if cfg!(windows) {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            out.push(Path::new(&local).join("Pandoc").join(exe));
        }
    }
    out
}

/// The first candidate that is a file.
pub fn find(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// `pandoc 3.8.2` (the first line of `--version`) → (3, 8).
pub fn parse_version(first_line: &str) -> Option<(u32, u32)> {
    let v = first_line.split_whitespace().nth(1)?;
    let mut it = v.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next().unwrap_or("0").parse().ok()?;
    Some((major, minor))
}

/// A reader name as Pandoc writes them (`docbook`, `mediawiki`, `jira`, `opml`, `t2t`, `markdown_strict`,
/// with `+ext` / `-ext` extensions): lowercase letters, digits and `_`, never starting with `-`.
pub fn is_format_name(s: &str) -> bool {
    let mut parts = s.split(|c| c == '+' || c == '-');
    let base = parts.next().unwrap_or("");
    !base.is_empty()
        && s.len() <= 64
        && base.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        && parts.all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'))
}

fn run(bin: &Path, args: &[OsString], timeout: Duration) -> Result<(Option<i32>, Vec<u8>, Vec<u8>), PandocError> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Pandoc reads no data or user folder of ours: its own defaults, nothing from the user's ~/.pandoc.
        .env("PANDOC_DATA_DIR", "")
        .spawn()
        .map_err(|e| PandocError::Spawn(e.to_string()))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(PandocError::Timeout(timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(PandocError::Io(e.to_string())),
        }
    }
    let out = child.wait_with_output().map_err(|e| PandocError::Io(e.to_string()))?;
    Ok((out.status.code(), out.stdout, out.stderr))
}

/// What the installed pandoc is: its version line and its readers.
#[derive(Debug, PartialEq)]
pub struct Status {
    pub version: String,
    pub readers: Vec<String>,
}

pub fn status(bin: &Path) -> Result<Status, PandocError> {
    let (_, out, _) = run(bin, &[OsString::from("--version")], Duration::from_secs(10))?;
    let version = String::from_utf8_lossy(&out).lines().next().unwrap_or("").trim().to_string();
    match parse_version(&version) {
        Some(v) if v >= MIN_VERSION => {}
        _ => return Err(PandocError::TooOld(version)),
    }
    let (_, out, _) = run(bin, &[OsString::from("--list-input-formats")], Duration::from_secs(10))?;
    let readers = String::from_utf8_lossy(&out).lines().map(|l| l.trim().to_string()).filter(|l| is_format_name(l)).collect();
    Ok(Status { version, readers })
}

/// The argument list of one conversion (exposed for the tests: it is fixed, and only `format` comes from the page).
pub fn convert_args(format: &str, input: &Path, output: &Path) -> Vec<OsString> {
    vec![
        "--sandbox".into(),
        "-f".into(),
        format.into(),
        "-t".into(),
        "gfm".into(),
        "--wrap=preserve".into(),
        "-o".into(),
        output.as_os_str().to_owned(),
        input.as_os_str().to_owned(),
    ]
}

/// Convert `input` (read with `format`, one of `readers`) to Markdown, in a fresh work folder under `tmp`.
pub fn convert(bin: &Path, readers: &[String], format: &str, ext: &str, input: &[u8], tmp: &Path, timeout: Duration) -> Result<String, PandocError> {
    let base = format.split(|c| c == '+' || c == '-').next().unwrap_or("");
    if !is_format_name(format) || !readers.iter().any(|r| r == base) {
        return Err(PandocError::BadFormat(format.to_string()));
    }
    if input.len() > MAX_INPUT {
        return Err(PandocError::TooLarge(input.len()));
    }
    let ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(10).collect();
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let work = tmp.join(format!("lumen-pandoc-{}-{}", std::process::id(), stamp));
    std::fs::create_dir_all(&work).map_err(|e| PandocError::Io(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&work, std::fs::Permissions::from_mode(0o700));
    }
    let result = (|| {
        let inp = work.join(format!("in.{}", if ext.is_empty() { "txt" } else { &ext }));
        let out = work.join("out.md");
        std::fs::write(&inp, input).map_err(|e| PandocError::Io(e.to_string()))?;
        let (code, _, stderr) = run(bin, &convert_args(format, &inp, &out), timeout)?;
        if code != Some(0) {
            let s = String::from_utf8_lossy(&stderr);
            let tail: String = s.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
            return Err(PandocError::Failed { code, stderr: tail });
        }
        std::fs::read_to_string(&out).map_err(|e| PandocError::Io(e.to_string()))
    })();
    let _ = std::fs::remove_dir_all(&work);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in pandoc: a shell script that answers --version / --list-input-formats and, for a
    /// conversion, checks the argument list is exactly the fixed one and writes canned Markdown per reader.
    #[cfg(unix)]
    fn fake(dir: &Path, version: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let bin = dir.join("pandoc");
        let script = format!(
            r#"#!/bin/sh
case "$1" in
  --version) echo "pandoc {version}"; exit 0;;
  --list-input-formats) printf 'docbook\nmediawiki\njira\nopml\nt2t\nmarkdown\n'; exit 0;;
esac
[ "$1" = "--sandbox" ] && [ "$2" = "-f" ] && [ "$4" = "-t" ] && [ "$5" = "gfm" ] && [ "$6" = "--wrap=preserve" ] && [ "$7" = "-o" ] || {{ echo "bad args: $*" >&2; exit 9; }}
in="$9"; out="$8"
[ "$#" = "9" ] || {{ echo "extra args" >&2; exit 9; }}
case "$3" in
  docbook) printf '# %s\n\nfrom DocBook\n' "$(sed -n 's:.*<title>\(.*\)</title>.*:\1:p' "$in" | head -n1)" > "$out";;
  mediawiki) printf '## Section\n\n[[Other page]]\n' > "$out";;
  jira) printf -- '- [ ] task\n' > "$out";;
  opml) printf -- '- outline\n  - child\n' > "$out";;
  t2t) printf '**bold**\n' > "$out";;
  slow) sleep 5;;
  *) echo "unknown reader $3" >&2; exit 21;;
esac
"#
        );
        std::fs::write(&bin, script).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lumen-pandoc-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn format_names() {
        for ok in ["docbook", "mediawiki", "jira", "opml", "t2t", "markdown_strict", "markdown+smart-raw_html"] {
            assert!(is_format_name(ok), "{ok}");
        }
        for bad in ["", "-o", "--sandbox", "docbook;rm", "Doc", "a b", "x+", "../x", "lua:reader.lua", "docbook --lua-filter=x"] {
            assert!(!is_format_name(bad), "{bad}");
        }
    }

    #[test]
    fn versions() {
        assert_eq!(parse_version("pandoc 3.8.2"), Some((3, 8)));
        assert_eq!(parse_version("pandoc.exe 2.15"), Some((2, 15)));
        assert!(parse_version("pandoc 2.14.2").unwrap() < MIN_VERSION);
        assert_eq!(parse_version("nope"), None);
    }

    #[test]
    fn candidates_in_order() {
        let c = candidates(Some("/x/pandoc"), Some("/a:/b"));
        assert_eq!(c[0], PathBuf::from("/x/pandoc"));
        assert_eq!(c[1], PathBuf::from("/a").join(if cfg!(windows) { "pandoc.exe" } else { "pandoc" }));
        assert!(find(&[PathBuf::from("/definitely/not/here")]).is_none());
    }

    #[test]
    fn the_argument_list_is_fixed() {
        let a = convert_args("docbook", Path::new("/w/in.xml"), Path::new("/w/out.md"));
        let s: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert_eq!(s, ["--sandbox", "-f", "docbook", "-t", "gfm", "--wrap=preserve", "-o", "/w/out.md", "/w/in.xml"]);
    }

    #[cfg(unix)]
    #[test]
    fn five_formats_through_a_fake_pandoc() {
        let d = tmp("five");
        let bin = fake(&d, "3.8.2");
        let st = status(&bin).unwrap();
        assert_eq!(st.version, "pandoc 3.8.2");
        let cases: [(&str, &str, &[u8], &str); 5] = [
            ("docbook", "xml", b"<article><title>\xd7\xa9\xd7\x9c\xd7\x95\xd7\x9d</title></article>", "# \u{05e9}\u{05dc}\u{05d5}\u{05dd}\n\nfrom DocBook\n"),
            ("mediawiki", "wiki", b"== Section ==", "## Section\n\n[[Other page]]\n"),
            ("jira", "txt", b"* task", "- [ ] task\n"),
            ("opml", "opml", b"<opml/>", "- outline\n  - child\n"),
            ("t2t", "t2t", b"**bold**", "**bold**\n"),
        ];
        for (fmt, ext, input, want) in cases {
            assert_eq!(convert(&bin, &st.readers, fmt, ext, input, &d, CONVERT_TIMEOUT).unwrap(), want, "{fmt}");
        }
        // The work folders are gone.
        assert!(std::fs::read_dir(&d).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with("lumen-pandoc-")));
    }

    #[cfg(unix)]
    #[test]
    fn refusals() {
        let d = tmp("refuse");
        let bin = fake(&d, "3.8.2");
        let st = status(&bin).unwrap();
        assert_eq!(convert(&bin, &st.readers, "docx", "docx", b"x", &d, CONVERT_TIMEOUT), Err(PandocError::BadFormat("docx".into())));
        assert_eq!(convert(&bin, &st.readers, "--lua-filter=x", "x", b"x", &d, CONVERT_TIMEOUT), Err(PandocError::BadFormat("--lua-filter=x".into())));
        let big = vec![b'a'; MAX_INPUT + 1];
        assert_eq!(convert(&bin, &st.readers, "jira", "txt", &big, &d, CONVERT_TIMEOUT), Err(PandocError::TooLarge(MAX_INPUT + 1)));
        let old = fake(&tmp("old"), "2.14.2");
        assert!(matches!(status(&old), Err(PandocError::TooOld(_))));
    }

    #[cfg(unix)]
    #[test]
    fn a_failure_and_a_timeout_are_reported() {
        let d = tmp("fail");
        let bin = fake(&d, "3.8.2");
        let readers: Vec<String> = vec!["markdown".into(), "slow".into()];
        match convert(&bin, &readers, "markdown", "md", b"x", &d, CONVERT_TIMEOUT) {
            Err(PandocError::Failed { code: Some(21), stderr }) => assert!(stderr.contains("unknown reader markdown")),
            other => panic!("{other:?}"),
        }
        assert_eq!(convert(&bin, &readers, "slow", "txt", b"x", &d, Duration::from_millis(300)), Err(PandocError::Timeout(0)));
    }
}
