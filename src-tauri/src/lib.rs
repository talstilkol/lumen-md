use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{Emitter, Manager};

/// Build the native menu bar and emit `lumen-menu` events when an item fires.
/// The frontend listens for these events in `useTauriMenu` and dispatches the
/// matching command from the in-app palette so behaviour stays identical to
/// the web build. Predefined items (Cut/Copy/Paste/Undo/Redo) handle
/// themselves natively without round-tripping through the WebView.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let pkg_info = app.package_info();
    let about = PredefinedMenuItem::about(
        app,
        Some("About Lumen"),
        Some(
            AboutMetadataBuilder::new()
                .name(Some("Lumen"))
                .version(Some(pkg_info.version.to_string()))
                .copyright(Some("© 2026 Lumen contributors"))
                .website(Some("https://github.com/talstilkol/lumen-md"))
                .build(),
        ),
    )?;

    let app_menu = SubmenuBuilder::new(app, "Lumen")
        .item(&about)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("file.new", "New").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&MenuItemBuilder::with_id("file.open", "Open…").accelerator("CmdOrCtrl+O").build(app)?)
        .item(&MenuItemBuilder::with_id("file.insertText", "Insert text…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file.save", "Save").accelerator("CmdOrCtrl+S").build(app)?)
        .item(&MenuItemBuilder::with_id("file.saveAs", "Save As…").accelerator("CmdOrCtrl+Shift+S").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file.exportHtml", "Export to HTML…").build(app)?)
        .item(&MenuItemBuilder::with_id("file.exportPdf", "Export to PDF").build(app)?)
        .item(&MenuItemBuilder::with_id("file.print", "Print…").accelerator("CmdOrCtrl+P").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file.toggleWorkspace", "Toggle workspace").build(app)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&MenuItemBuilder::with_id("edit.find", "Find & Replace").accelerator("CmdOrCtrl+F").build(app)?)
        .item(&MenuItemBuilder::with_id("edit.workspaceSearch", "Search workspace").accelerator("CmdOrCtrl+Shift+F").build(app)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("view.source", "Source").accelerator("CmdOrCtrl+1").build(app)?)
        .item(&MenuItemBuilder::with_id("view.split", "Split").accelerator("CmdOrCtrl+2").build(app)?)
        .item(&MenuItemBuilder::with_id("view.preview", "Preview").accelerator("CmdOrCtrl+3").build(app)?)
        .item(&MenuItemBuilder::with_id("view.wysiwyg", "WYSIWYG").accelerator("CmdOrCtrl+4").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view.toggleOutline", "Toggle outline").build(app)?)
        .item(&MenuItemBuilder::with_id("view.focusMode", "Focus mode").accelerator("CmdOrCtrl+Shift+F").build(app)?)
        .item(&MenuItemBuilder::with_id("view.toggleTheme", "Toggle theme").build(app)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help.commandPalette", "Command palette…").accelerator("CmdOrCtrl+K").build(app)?)
        .item(&MenuItemBuilder::with_id("help.shortcuts", "Keyboard shortcuts").build(app)?)
        .item(&MenuItemBuilder::with_id("help.tour", "Guided tour").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("help.github", "GitHub repository").build(app)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}

// ── The vault folder (plan 4.3) ─────────────────────────────────────────
//
// The WebView reads and writes notes only through these commands, and only
// inside the folder the user picked in the native dialog (lumen-vault checks
// every path). There is no command that sets the folder from a path string:
// the root comes from the dialog, or from the app's own config file that the
// dialog wrote. No `fs:` permission is granted to the WebView.

mod desktop_vault {
    use lumen_vault::{Entry, Stat, Vault};
    use std::path::PathBuf;
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager, State};
    use tauri_plugin_dialog::DialogExt;

    #[derive(Default)]
    pub struct VaultState(pub Mutex<Option<Vault>>);

    fn config_file(app: &AppHandle) -> Option<PathBuf> {
        app.path().app_config_dir().ok().map(|d| d.join("vault.json"))
    }

    /// The folder chosen earlier, if it still exists.
    pub fn load(app: &AppHandle) -> Option<Vault> {
        let text = std::fs::read_to_string(config_file(app)?).ok()?;
        let v: serde_json::Value = serde_json::from_str(&text).ok()?;
        Vault::open(v.get("root")?.as_str()?).ok()
    }

    fn save(app: &AppHandle, root: Option<&std::path::Path>) -> Result<(), String> {
        let file = config_file(app).ok_or("EIO: no config folder")?;
        match root {
            Some(r) => {
                std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| format!("EIO: {e}"))?;
                let body = serde_json::json!({ "root": r.display().to_string() }).to_string();
                std::fs::write(&file, body).map_err(|e| format!("EIO: {e}"))
            }
            None => match std::fs::remove_file(&file) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(format!("EIO: {e}")),
            },
        }
    }

    fn with<T>(state: &State<VaultState>, f: impl FnOnce(&Vault) -> lumen_vault::Result<T>) -> Result<T, String> {
        let guard = state.0.lock().map_err(|_| "EIO: vault lock poisoned".to_string())?;
        let vault = guard.as_ref().ok_or_else(|| "ENOVAULT: no vault folder chosen".to_string())?;
        f(vault).map_err(|e| e.to_string())
    }

    /// The vault folder's absolute path, or null when none is chosen.
    #[tauri::command]
    pub fn vault_root(state: State<VaultState>) -> Option<String> {
        state.0.lock().ok()?.as_ref().map(|v| v.root().display().to_string())
    }

    /// Ask the user for the vault folder (native dialog). Null when cancelled.
    #[tauri::command]
    pub async fn vault_pick_folder(app: AppHandle, state: State<'_, VaultState>) -> Result<Option<String>, String> {
        let Some(picked) = app.dialog().file().set_title("Choose the folder for your Lumen vault").blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| format!("EINVAL: {e}"))?;
        let vault = Vault::open(&path).map_err(|e| e.to_string())?;
        save(&app, Some(vault.root()))?;
        let root = vault.root().display().to_string();
        *state.0.lock().map_err(|_| "EIO: vault lock poisoned".to_string())? = Some(vault);
        Ok(Some(root))
    }

    /// Stop using the folder (the vault goes back to app storage). The folder is not touched.
    #[tauri::command]
    pub fn vault_forget(app: AppHandle, state: State<VaultState>) -> Result<(), String> {
        save(&app, None)?;
        *state.0.lock().map_err(|_| "EIO: vault lock poisoned".to_string())? = None;
        Ok(())
    }

    #[tauri::command]
    pub fn vault_list(state: State<VaultState>, dir: String) -> Result<Vec<Entry>, String> {
        with(&state, |v| v.list(&dir))
    }

    #[tauri::command]
    pub fn vault_stat(state: State<VaultState>, path: String) -> Result<Option<Stat>, String> {
        with(&state, |v| v.stat(&path))
    }

    /// The file's bytes, as a raw IPC response (an ArrayBuffer in the WebView).
    #[tauri::command]
    pub fn vault_read(state: State<VaultState>, path: String) -> Result<tauri::ipc::Response, String> {
        with(&state, |v| v.read(&path)).map(tauri::ipc::Response::new)
    }

    /// Percent-decode a header value (the path is sent `encodeURIComponent`-ed:
    /// HTTP headers carry only ASCII, vault paths are Unicode).
    fn percent_decode(s: &str) -> Result<String, String> {
        let b = s.as_bytes();
        let mut out = Vec::with_capacity(b.len());
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'%' {
                let hex = s.get(i + 1..i + 3).ok_or("EINVAL: bad path encoding")?;
                out.push(u8::from_str_radix(hex, 16).map_err(|_| "EINVAL: bad path encoding")?);
                i += 3;
            } else {
                out.push(b[i]);
                i += 1;
            }
        }
        String::from_utf8(out).map_err(|_| "EINVAL: bad path encoding".into())
    }

    /// Write a file. The bytes are the raw request body (no JSON array of
    /// numbers for a 5 MB image); the path is the `x-vault-path` header.
    #[tauri::command]
    pub fn vault_write(state: State<VaultState>, request: tauri::ipc::Request) -> Result<(), String> {
        let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
            return Err("EINVAL: vault_write expects raw bytes".into());
        };
        let path = request
            .headers()
            .get("x-vault-path")
            .and_then(|h| h.to_str().ok())
            .ok_or("EINVAL: missing x-vault-path header")?;
        let path = percent_decode(path)?;
        with(&state, |v| v.write(&path, data))
    }

    #[tauri::command]
    pub fn vault_mkdir(state: State<VaultState>, path: String) -> Result<(), String> {
        with(&state, |v| v.mkdir(&path))
    }

    #[tauri::command]
    pub fn vault_rename(state: State<VaultState>, from: String, to: String, overwrite: bool) -> Result<(), String> {
        with(&state, |v| v.rename(&from, &to, overwrite))
    }

    #[tauri::command]
    pub fn vault_remove(state: State<VaultState>, path: String) -> Result<(), String> {
        with(&state, |v| v.remove(&path))
    }

    /// Keep a backup (e.g. a zip of the browser-storage vault before a
    /// migration) in the app's data folder; returns where it went.
    #[tauri::command]
    pub fn vault_backup(app: AppHandle, request: tauri::ipc::Request) -> Result<String, String> {
        let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
            return Err("EINVAL: vault_backup expects raw bytes".into());
        };
        let name = request
            .headers()
            .get("x-backup-name")
            .and_then(|h| h.to_str().ok())
            .ok_or("EINVAL: missing x-backup-name header")?;
        let name = percent_decode(name)?;
        let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
        if safe.is_empty() || safe.starts_with('.') {
            return Err("EINVAL: invalid backup name".into());
        }
        let dir = app.path().app_data_dir().map_err(|e| format!("EIO: {e}"))?.join("backups");
        std::fs::create_dir_all(&dir).map_err(|e| format!("EIO: {e}"))?;
        let file = dir.join(safe);
        std::fs::write(&file, data).map_err(|e| format!("EIO: {e}"))?;
        Ok(file.display().to_string())
    }
}

const KEYCHAIN_SERVICE: &str = "app.lumen.secrets";

/// Is the OS keychain available to `secret_get` / `secret_set` (T36)?
#[tauri::command]
fn secret_available() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())
}

/// Read one secret from the OS keychain; `None` when it isn't there.
#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        match entry(&name)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (name, KEYCHAIN_SERVICE);
        Err("keychain unavailable on this platform".into())
    }
}

/// Store (or with `None`, delete) one secret in the OS keychain.
#[tauri::command]
fn secret_set(name: String, value: Option<String>) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let e = entry(&name)?;
        match value {
            Some(v) => e.set_password(&v).map_err(|e| e.to_string()),
            None => match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(err) => Err(err.to_string()),
            },
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (name, value);
        Err("keychain unavailable on this platform".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(desktop_vault::VaultState::default())
        .invoke_handler(tauri::generate_handler![
            secret_available,
            secret_get,
            secret_set,
            desktop_vault::vault_root,
            desktop_vault::vault_pick_folder,
            desktop_vault::vault_forget,
            desktop_vault::vault_list,
            desktop_vault::vault_stat,
            desktop_vault::vault_read,
            desktop_vault::vault_write,
            desktop_vault::vault_mkdir,
            desktop_vault::vault_rename,
            desktop_vault::vault_remove,
            desktop_vault::vault_backup,
        ])
        .setup(|app| {
            // The folder chosen on an earlier run (plan 4.3).
            if let Some(v) = desktop_vault::load(app.handle()) {
                if let Ok(mut slot) = app.state::<desktop_vault::VaultState>().0.lock() {
                    *slot = Some(v);
                }
            }
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                let menu = build_menu(&handle)?;
                app.set_menu(menu)?;
                app.on_menu_event(move |app, event| {
                    let id = event.id().0.as_str();
                    if id == "help.github" {
                        // Open in default browser via the dialog plugin's url handler.
                        let _ = tauri_plugin_dialog::DialogExt::dialog(app)
                            .message("https://github.com/talstilkol/lumen-md")
                            .show(|_| {});
                        return;
                    }
                    let _ = app.emit("lumen-menu", id.to_string());
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lumen");
}
