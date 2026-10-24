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
/// A `lumen://` link (plan 4.15.2: `lumen://clip?data=…` from the web
/// clipper), passed to the window. Anything else is ignored.
fn forward_deep_links(app: &tauri::AppHandle, urls: Vec<String>) {
    for url in urls.into_iter().filter(|u| is_lumen_link(u)) {
        let _ = app.emit("lumen-deep-link", url);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
}

/// Only our own scheme, and not absurdly long (a clip carries a page's HTML).
pub fn is_lumen_link(url: &str) -> bool {
    url.len() <= 4 * 1024 * 1024 && url.to_ascii_lowercase().starts_with("lumen://")
}

pub fn run() {
    let builder = tauri::Builder::default();
    // Must be the first plugin: a second launch (the OS opening lumen://…)
    // hands its arguments to the running app and exits.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        forward_deep_links(app, argv);
    }));
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![secret_available, secret_get, secret_set])
        .setup(|app| {
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    forward_deep_links(&handle, event.urls().iter().map(|u| u.to_string()).collect());
                });
                // Linux and Windows register the scheme at run time (installers do it too).
                #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
                let _ = app.deep_link().register_all();
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
                        tauri_plugin_dialog::DialogExt::dialog(app)
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

#[cfg(test)]
mod deep_link_tests {
    use super::is_lumen_link;

    #[test]
    fn only_lumen_links_are_forwarded() {
        assert!(is_lumen_link("lumen://clip?data=%7B%7D"));
        assert!(is_lumen_link("LUMEN://clip"));
        assert!(!is_lumen_link("https://evil.example/lumen://clip"));
        assert!(!is_lumen_link("/usr/bin/lumen"));
        assert!(!is_lumen_link(&format!("lumen://clip?data={}", "x".repeat(4 * 1024 * 1024))));
    }
}
