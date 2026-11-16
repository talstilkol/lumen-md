//! MCP servers on stdio in the desktop app (plan W7.18, W10.C1): the Tauri glue
//! around the std-only `lumen-mcp-stdio` crate (src-tauri/mcp-stdio, tested with
//! `rustc --test`). Desktop only.
//!
//! - `mcp_stdio_approve` asks the user in a **native** dialog (not the WebView)
//!   to allow one exact command; the approvals live in the app's config folder.
//!   A page that runs script in the WebView can ask, but cannot answer. The
//!   dialog (Hebrew or English, `lang`) shows the program's resolved full path,
//!   each argument quoted on its own line, the sha256 of the program and of
//!   every file an argument names, and says that the server's name comes from
//!   the page (R8-M4).
//! - The approvals are an **allow-list** (plan W13.X1): absolute path, sha256
//!   and the full argv, pinned (`lumen_mcp_stdio::AllowList`). One changed byte
//!   or any other argument is refused before a process starts.
//! - `mcp_stdio_spawn` starts only through `checked_spawn` (the deny-list, then
//!   the pin), and starts the resolved file, not a name looked up again.
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

use lumen_mcp_stdio::{checked_spawn, clean_env, may_spawn, open_url_command, pin, pin_text, revoke_key_of, AllowList, Event, Lang, Session, Spec, WRITE_TIMEOUT};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct McpStdioInner {
    approved: Option<AllowList>,
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

/// The pinned allow-list (format 2). The old command-line-only file is no longer read: approve again.
const FILE: &str = "mcp-stdio-allowlist.txt";

fn approved_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(FILE))
}

fn load(app: &AppHandle, inner: &mut McpStdioInner) -> Result<(), String> {
    if inner.approved.is_none() {
        let text = std::fs::read_to_string(approved_path(app)?).unwrap_or_default();
        inner.approved = Some(AllowList::parse(&text));
    }
    Ok(())
}

fn save(app: &AppHandle, approved: &AllowList) -> Result<(), String> {
    let path = approved_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, approved.serialize()).map_err(|e| e.to_string())
}

fn spec(command: String, args: Vec<String>, cwd: Option<String>) -> Spec {
    Spec { command, args, cwd: cwd.filter(|c| !c.is_empty()) }
}

/// The PATH a server gets (clean_env keeps it): a bare program name is resolved on it, once, when pinned.
fn path_var() -> Option<String> {
    std::env::var("PATH").ok()
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
        let empty = AllowList::default();
        Ok(may_spawn(&s, inner.approved.as_ref().unwrap_or(&empty), path_var().as_deref()).is_ok())
    })
    .await
}

/// Ask the user, in a native dialog, to allow this exact command (pinned: full path, sha256, argv).
/// `lang` is the UI's language ("he" shows the dialog in Hebrew). Async: the dialog blocks its thread.
#[tauri::command]
pub async fn mcp_stdio_approve(app: AppHandle, state: State<'_, McpStdio>, server: String, command: String, args: Vec<String>, cwd: Option<String>, lang: Option<String>) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let s = spec(command, args, cwd);
    s.validate()?;
    let lang = Lang::of(lang.as_deref());
    let inner = state.0.clone();
    blocking(move || {
        // Resolved and hashed now: what the dialog shows is exactly what gets pinned.
        let p = pin(&s, path_var().as_deref())?;
        let changed = {
            let mut guard = inner.lock().map_err(|_| "EIO: lock")?;
            load(&app, &mut guard)?;
            let list = guard.approved.get_or_insert_with(AllowList::default);
            if list.allows(&p) {
                return Ok(true);
            }
            list.changed(&p)
        };
        // The lock is not held while the dialog is open.
        let yes = app
            .dialog()
            .message(pin_text(&server, &p, changed, lang))
            .title(lang.title())
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(lang.allow().into(), lang.deny().into()))
            .blocking_show();
        if !yes {
            return Ok(false);
        }
        let mut guard = inner.lock().map_err(|_| "EIO: lock")?;
        load(&app, &mut guard)?;
        let approved = guard.approved.get_or_insert_with(AllowList::default);
        approved.add(&p);
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
        let approved = inner.approved.get_or_insert_with(AllowList::default);
        let removed = approved.revoke_key(&revoke_key_of(&s, path_var().as_deref()));
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
        let (id, list) = {
            let mut guard = inner.lock().map_err(|_| "EIO: lock")?;
            load(&app, &mut guard)?;
            let list = guard.approved.clone().unwrap_or_default();
            guard.next = guard.next.wrapping_add(1).max(1);
            (guard.next, list)
        };
        let handle = app.clone();
        let map = inner.clone();
        // Started without the lock held (hashing the program takes a moment). checked_spawn refuses,
        // before any process exists, anything that is not exactly a pin on the allow-list (W13.X1).
        // The exit event removes the session again.
        let session = checked_spawn(&s, &list, path_var().as_deref(), clean_env(std::env::vars()), move |e| {
            let (kind, line) = match e {
                Event::Out(l) => ("out", l),
                Event::Err(l) => ("err", l),
                Event::Exit(c) => {
                    // R8b-L5: take the session out under the lock, drop it after. The last Arc<Session>
                    // dropped runs Session::drop (a close with a grace wait), which must not hold the map.
                    let gone = match map.lock() {
                        Ok(mut g) => g.sessions.remove(&id),
                        Err(_) => None,
                    };
                    drop(gone);
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
