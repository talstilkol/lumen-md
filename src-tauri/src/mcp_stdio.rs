//! MCP servers on stdio in the desktop app (plan W7.18, W10.C1): the Tauri glue
//! around the std-only `lumen-mcp-stdio` crate (src-tauri/mcp-stdio, tested with
//! `rustc --test`). Desktop only.
//!
//! - `mcp_stdio_approve` asks the user in a **native** dialog (not the WebView)
//!   to allow one exact command; the approvals live in the app's config folder.
//!   A page that runs script in the WebView can ask, but cannot answer.
//! - `mcp_stdio_spawn` starts only an approved, valid command (`may_spawn`).
//! - Lines come back as `mcp-stdio` events: `{ session, kind: "out" | "err" | "exit", line }`.
//!   The WebView matches responses to requests by JSON-RPC id (transports/stdio.ts).
//! - `mcp_stdio_close` closes stdin, waits, then kills.
//! - `mcp_open_url` opens an elicitation URL in the system browser (http/https only).

use lumen_mcp_stdio::{clean_env, may_spawn, open_url_command, spawn, Approved, Event, Session, Spec};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct McpStdioInner {
    approved: Option<Approved>,
    sessions: HashMap<u32, Session>,
    next: u32,
}

#[derive(Default)]
pub struct McpStdio(pub Mutex<McpStdioInner>);

#[derive(Serialize, Clone)]
struct LineEvent {
    session: u32,
    kind: &'static str,
    line: String,
}

const FILE: &str = "mcp-stdio-approved.txt";

fn approved_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(FILE))
}

fn load(app: &AppHandle, inner: &mut McpStdioInner) -> Result<(), String> {
    if inner.approved.is_none() {
        let text = std::fs::read_to_string(approved_path(app)?).unwrap_or_default();
        inner.approved = Some(Approved::parse(&text));
    }
    Ok(())
}

fn save(app: &AppHandle, approved: &Approved) -> Result<(), String> {
    let path = approved_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, approved.serialize()).map_err(|e| e.to_string())
}

fn spec(command: String, args: Vec<String>, cwd: Option<String>) -> Spec {
    Spec { command, args, cwd: cwd.filter(|c| !c.is_empty()) }
}

/// Is this exact command approved? (Never asks.)
#[tauri::command]
pub fn mcp_stdio_approved(app: AppHandle, state: State<McpStdio>, command: String, args: Vec<String>, cwd: Option<String>) -> Result<bool, String> {
    let s = spec(command, args, cwd);
    let mut inner = state.0.lock().map_err(|_| "EIO: lock")?;
    load(&app, &mut inner)?;
    Ok(s.validate().is_ok() && inner.approved.as_ref().map(|a| a.contains(&s)).unwrap_or(false))
}

/// Ask the user, in a native dialog, to allow this exact command. Async: the dialog blocks its thread.
#[tauri::command]
pub async fn mcp_stdio_approve(app: AppHandle, state: State<'_, McpStdio>, server: String, command: String, args: Vec<String>, cwd: Option<String>) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let s = spec(command, args, cwd);
    s.validate()?;
    {
        let mut inner = state.0.lock().map_err(|_| "EIO: lock")?;
        load(&app, &mut inner)?;
        if inner.approved.as_ref().map(|a| a.contains(&s)).unwrap_or(false) {
            return Ok(true);
        }
    }
    let shown = format!(
        "The MCP server \"{}\" wants Lumen to run this program on your computer:\n\n{} {}\n\nFolder: {}\n\nIt runs with your user's rights. Allow only a program you installed and trust.",
        server.chars().take(120).collect::<String>(),
        s.command,
        s.args.join(" "),
        s.cwd.clone().unwrap_or_else(|| "(Lumen's default)".into())
    );
    let yes = app
        .dialog()
        .message(shown)
        .title("Run an MCP server?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Allow".into(), "Don't allow".into()))
        .blocking_show();
    if !yes {
        return Ok(false);
    }
    let mut inner = state.0.lock().map_err(|_| "EIO: lock")?;
    load(&app, &mut inner)?;
    let approved = inner.approved.get_or_insert_with(Approved::default);
    approved.add(&s);
    save(&app, approved)?;
    Ok(true)
}

#[tauri::command]
pub fn mcp_stdio_revoke(app: AppHandle, state: State<McpStdio>, command: String, args: Vec<String>, cwd: Option<String>) -> Result<bool, String> {
    let s = spec(command, args, cwd);
    let mut inner = state.0.lock().map_err(|_| "EIO: lock")?;
    load(&app, &mut inner)?;
    let approved = inner.approved.get_or_insert_with(Approved::default);
    let removed = approved.remove(&s);
    save(&app, approved)?;
    Ok(removed)
}

#[tauri::command]
pub fn mcp_stdio_spawn(app: AppHandle, state: State<McpStdio>, command: String, args: Vec<String>, cwd: Option<String>) -> Result<u32, String> {
    let s = spec(command, args, cwd);
    let mut inner = state.0.lock().map_err(|_| "EIO: lock")?;
    load(&app, &mut inner)?;
    may_spawn(&s, inner.approved.as_ref().unwrap_or(&Approved::default()))?;
    inner.next = inner.next.wrapping_add(1).max(1);
    let id = inner.next;
    let handle = app.clone();
    let session = spawn(&s, clean_env(std::env::vars()), move |e| {
        let (kind, line) = match e {
            Event::Out(l) => ("out", l),
            Event::Err(l) => ("err", l),
            Event::Exit(c) => ("exit", c.map(|c| c.to_string()).unwrap_or_default()),
        };
        let _ = handle.emit("mcp-stdio", LineEvent { session: id, kind, line });
    })?;
    inner.sessions.insert(id, session);
    Ok(id)
}

#[tauri::command]
pub fn mcp_stdio_write(state: State<McpStdio>, session: u32, line: String) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "EIO: lock")?;
    inner.sessions.get_mut(&session).ok_or("no such server process")?.write_line(&line)
}

#[tauri::command]
pub fn mcp_stdio_close(state: State<McpStdio>, session: u32) -> Result<Option<i32>, String> {
    let s = {
        let mut inner = state.0.lock().map_err(|_| "EIO: lock")?;
        inner.sessions.remove(&session)
    };
    Ok(s.and_then(|mut s| s.close(Duration::from_secs(2))))
}

/// Elicitation URL mode: the system browser, which neither Lumen nor the model can read.
#[tauri::command]
pub fn mcp_open_url(url: String) -> Result<(), String> {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    };
    let (prog, args) = open_url_command(&url, os)?;
    std::process::Command::new(prog).args(args).spawn().map(|_| ()).map_err(|e| e.to_string())
}
