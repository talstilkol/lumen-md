use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{Emitter, Manager};

mod whisper_core;

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

// ── Desktop Whisper (plan W1.17) ────────────────────────────────────────
//
// ivrit.ai's Hebrew Whisper as ggml through the whisper.cpp CLI
// (`whisper-cli`, MIT), which the user installs; Lumen bundles neither the
// binary nor the model. The model file must be the pinned one (size +
// sha256 from the app); nothing here downloads anything. Logic and tests:
// whisper_core.rs.

#[derive(serde::Serialize)]
struct WhisperStatus {
    cli: Option<String>,
    model: &'static str,
    model_path: Option<String>,
}

#[derive(serde::Serialize)]
struct WhisperSegment {
    start_ms: u64,
    end_ms: u64,
    text: String,
}

fn whisper_dirs(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn whisper_cli(app_data: &std::path::Path) -> Option<std::path::PathBuf> {
    let env = std::env::var("LUMEN_WHISPER_CLI").ok();
    let path = std::env::var("PATH").ok();
    whisper_core::find_cli(&whisper_core::cli_candidates(env.as_deref(), app_data, path.as_deref()))
}

/// Is desktop Whisper usable: a `whisper-cli` binary and the pinned model file?
#[tauri::command]
async fn whisper_status(app: tauri::AppHandle, file: String, bytes: u64, sha256: String) -> Result<WhisperStatus, String> {
    let data = whisper_dirs(&app)?;
    let cli = whisper_cli(&data).map(|p| p.display().to_string());
    let Some(model) = whisper_core::model_path(&data, &file) else { return Err("invalid model file name".into()) };
    let state = tauri::async_runtime::spawn_blocking({
        let model = model.clone();
        move || whisper_core::check_model(&model, bytes, &sha256)
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(WhisperStatus { cli, model: state.as_str(), model_path: Some(model.display().to_string()) })
}

/// Transcribe raw 16 kHz mono 16-bit LE PCM (the request body) with
/// whisper-cli. Headers: x-lumen-lang (ISO-639-1), x-lumen-model-file,
/// x-lumen-model-bytes, x-lumen-model-sha256. The audio is written to a
/// temporary WAV that is removed afterwards; it never leaves the machine.
#[tauri::command]
async fn whisper_transcribe(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Vec<WhisperSegment>, String> {
    let tauri::ipc::InvokeBody::Raw(pcm) = request.body() else { return Err("expected raw PCM".into()) };
    let pcm = pcm.clone();
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let lang = header("x-lumen-lang");
    let file = header("x-lumen-model-file");
    let sha256 = header("x-lumen-model-sha256");
    let bytes: u64 = header("x-lumen-model-bytes").parse().map_err(|_| "x-lumen-model-bytes".to_string())?;
    if !whisper_core::valid_language(&lang) {
        return Err("invalid language".into());
    }
    let data = whisper_dirs(&app)?;
    let cli = whisper_cli(&data).ok_or("whisper-cli not found")?;
    let model = whisper_core::model_path(&data, &file).ok_or("invalid model file name")?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<WhisperSegment>, String> {
        let state = whisper_core::check_model(&model, bytes, &sha256);
        if state != whisper_core::ModelState::Ok {
            return Err(format!("model {}", state.as_str()));
        }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!("lumen-whisper-{}-{}", std::process::id(), stamp));
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        let wav = tmp.join("in.wav");
        let out_prefix = tmp.join("out");
        let run = (|| -> Result<Vec<WhisperSegment>, String> {
            let mut f = std::fs::File::create(&wav).map_err(|e| e.to_string())?;
            whisper_core::write_wav(&mut f, &pcm).map_err(|e| e.to_string())?;
            drop(f);
            let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
            let status = std::process::Command::new(&cli)
                .args(whisper_core::cli_args(&model, &wav, &lang, &out_prefix, threads))
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .output()
                .map_err(|e| e.to_string())?;
            if !status.status.success() {
                let err = String::from_utf8_lossy(&status.stderr);
                return Err(format!("whisper-cli failed: {}", err.chars().rev().take(300).collect::<String>().chars().rev().collect::<String>()));
            }
            let srt = std::fs::read_to_string(tmp.join("out.srt")).map_err(|e| e.to_string())?;
            Ok(whisper_core::parse_srt(&srt)
                .into_iter()
                .map(|s| WhisperSegment { start_ms: s.start_ms, end_ms: s.end_ms, text: s.text })
                .collect())
        })();
        let _ = std::fs::remove_dir_all(&tmp);
        run
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![secret_available, secret_get, secret_set, whisper_status, whisper_transcribe])
        .setup(|app| {
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
