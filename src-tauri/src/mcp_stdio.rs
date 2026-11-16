//! MCP servers on stdio in the desktop app (plan W7.18, W10.C1): the Tauri glue
//! around the std-only `lumen-mcp-stdio` crate (src-tauri/mcp-stdio, tested with
//! `rustc --test`). Desktop only.
//!
//! - `mcp_stdio_approve` asks the user in a **native** dialog (not the WebView)
//!   to allow one exact command; the approvals live in the app's config folder.
//!   A page that runs script in the WebView can ask, but cannot answer. The
//!   dialog shows each argument quoted on its own line, and says that the
//!   server's name comes from the page (R8-M4).
//! - `mcp_stdio_spawn` starts only an approved, valid command (`may_spawn`).
//! - Lines come back as `mcp-stdio` events: `{ session, kind: "out" | "err" | "exit", line }`.
//!   The WebView matches responses to requests by JSON-RPC id (transports/stdio.ts).
//!   A session whose process exited leaves the map (R8-M3).
//! - `mcp_stdio_close` closes stdin, waits, then kills.
//! - `mcp_open_url` opens an elicitation URL in the system browser (http/https only).
//!
//! R8-M3: every command is `async` and does its blocking work (files, the
//! process, pipe writes, the shutdown wait) in `spawn_blocking`, never on the
//! main thread. The map lock is held only to look a session up; each session
//! writes through its own writer thread with a timeout (`WRITE_TIMEOUT`), so a
//! server that stops reading blocks neither the UI nor the other servers.

use lumen_mcp_stdio::{approval_text, clean_env, may_spawn, open_url_command, spawn, Approved, Event, Session, Spec, WRITE_TIMEOUT};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct McpStdioInner {
    approved: Option<Approved>,
    sessions: HashMap<u32, Arc<Session>>,
    next: u32,
}

#[derive(Default)]
pub struct McpStdio(pub Arc<Mutex<McpStdioInner>>);

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

/// Run `f` off the main thread and the async workers (it may block on files, a pipe or a process).
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Is this exact command approved? (Never asks.)
#[tauri::command]
pub async fn mcp_stdio_approved(app: AppHandle, state: State<'_, McpStdio>, command: String, args: Vec<String>, cwd: Option<String>) -> Result<bool, String> {
    let s = spec(command, args, cwd);
    let inner = state.0.clone();
    blocking(move || {
        let mut inner = inner.lock().map_err(|_| "EIO: lock")?;
        load(&app, &mut inner)?;
        Ok(s.validate().is_ok() && inner.approved.as_ref().map(|a| a.contains(&s)).unwrap_or(false))
    })
    .await
}

/// Ask the user, in a native dialog, to allow this exact command. Async: the dialog blocks its thread.
#[tauri::command]
pub async fn mcp_stdio_approve(app: AppHandle, state: State<'_, McpStdio>, server: String, command: String, args: Vec<String>, cwd: Option<String>) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let s = spec(command, args, cwd);
    s.validate()?;
    let inner = state.0.clone();
    blocking(move || {
        {
            let mut guard = inner.lock().map_err(|_| "EIO: lock")?;
            load(&app, &mut guard)?;
            if guard.approved.as_ref().map(|a| a.contains(&s)).unwrap_or(false) {
                return Ok(true);
            }
        }
        // The lock is not held while the dialog is open.
        let yes = app
            .dialog()
            .message(approval_text(&server, &s))
            .title("Run an MCP server?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Allow".into(), "Don't allow".into()))
            .blocking_show();
        if !yes {
            return Ok(false);
        }
        let mut guard = inner.lock().map_err(|_| "EIO: lock")?;
        load(&app, &mut guard)?;
        let approved = guard.approved.get_or_insert_with(Approved::default);
        approved.add(&s);
        save(&app, approved)?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn mcp_stdio_revoke(app: AppHandle, state: State<'_, McpStdio>, command: String, args: Vec<String>, cwd: Option<String>) -> Result<bool, String> {
    let s = spec(command, args, cwd);
    let inner = state.0.clone();
    blocking(move || {
        let mut inner = inner.lock().map_err(|_| "EIO: lock")?;
        load(&app, &mut inner)?;
        let approved = inner.approved.get_or_insert_with(Approved::default);
        let removed = approved.remove(&s);
        save(&app, approved)?;
        Ok(removed)
    })
    .await
}

#[tauri::command]
pub async fn mcp_stdio_spawn(app: AppHandle, state: State<'_, McpStdio>, command: String, args: Vec<String>, cwd: Option<String>) -> Result<u32, String> {
    let s = spec(command, args, cwd);
    let inner = state.0.clone();
    blocking(move || {
        let id = {
            let mut guard = inner.lock().map_err(|_| "EIO: lock")?;
            load(&app, &mut guard)?;
            may_spawn(&s, guard.approved.as_ref().unwrap_or(&Approved::default()))?;
            guard.next = guard.next.wrapping_add(1).max(1);
            guard.next
        };
        let handle = app.clone();
        let map = inner.clone();
        // Started without the lock held; the exit event removes the session again.
        let session = spawn(&s, clean_env(std::env::vars()), move |e| {
            let (kind, line) = match e {
                Event::Out(l) => ("out", l),
                Event::Err(l) => ("err", l),
                Event::Exit(c) => {
                    if let Ok(mut g) = map.lock() {
                        g.sessions.remove(&id);
                    }
                    ("exit", c.map(|c| c.to_string()).unwrap_or_default())
                }
            };
            let _ = handle.emit("mcp-stdio", LineEvent { session: id, kind, line });
        })?;
        let session = Arc::new(session);
        let mut guard = inner.lock().map_err(|_| "EIO: lock")?;
        if session.running() {
            guard.sessions.insert(id, session);
        }
        Ok(id)
    })
    .await
}

fn session_of(state: &McpStdio, session: u32) -> Result<Arc<Session>, String> {
    let inner = state.0.lock().map_err(|_| "EIO: lock")?;
    inner.sessions.get(&session).cloned().ok_or_else(|| "no such server process".to_string())
}

#[tauri::command]
pub async fn mcp_stdio_write(state: State<'_, McpStdio>, session: u32, line: String) -> Result<(), String> {
    let s = session_of(&state, session)?;
    blocking(move || s.write_line_within(&line, WRITE_TIMEOUT)).await
}

#[tauri::command]
pub async fn mcp_stdio_close(state: State<'_, McpStdio>, session: u32) -> Result<Option<i32>, String> {
    let s = {
        let mut inner = state.0.lock().map_err(|_| "EIO: lock")?;
        inner.sessions.remove(&session)
    };
    match s {
        Some(s) => blocking(move || Ok(s.close(Duration::from_secs(2)))).await,
        None => Ok(None),
    }
}

/// Elicitation URL mode: the system browser, which neither Lumen nor the model can read.
#[tauri::command]
pub async fn mcp_open_url(url: String) -> Result<(), String> {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    };
    let (prog, args) = open_url_command(&url, os)?;
    blocking(move || std::process::Command::new(prog).args(args).spawn().map(|_| ()).map_err(|e| e.to_string())).await
}
