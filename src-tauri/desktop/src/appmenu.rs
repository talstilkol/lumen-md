//! The native menu bar (plan W13.K5): the WebView sends the menu in the UI
//! language (src/desktop/nativeMenu.ts) with the tray labels; this module
//! checks it before the shell builds it. A page that runs script in the
//! WebView can relabel the menu, but cannot add an item that does anything
//! the palette cannot: every item is a palette command id (sent back to the
//! WebView as a `lumen-menu` event) or one of the system's own items.

/// The system's items the shell builds as predefined menu items.
pub const ROLES: &[&str] = &[
    "about", "services", "hide", "hideOthers", "showAll", "quit", "undo", "redo", "cut", "copy", "paste", "selectAll", "minimize", "zoom", "fullscreen", "closeWindow",
];

/// Roles that exist only in the macOS application menu.
pub const MAC_ONLY_ROLES: &[&str] = &["about", "services", "hide", "hideOthers", "showAll"];

pub const MAX_SECTIONS: usize = 8;
pub const MAX_ITEMS: usize = 40;
pub const MAX_LABEL: usize = 80;

#[derive(Debug, Clone, PartialEq)]
pub enum Entry {
    Command { id: String, label: String, accel: Option<String> },
    Role { role: String, label: String },
    Separator,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub id: String,
    pub label: String,
    pub items: Vec<Entry>,
}

/// A palette command id: `file.new`, `view.readingOptions`, `app.checkUpdates`.
pub fn is_command_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    id.len() <= 64 && parts.len() >= 2 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric())) && parts[0].starts_with(|c: char| c.is_ascii_lowercase())
}

/// An accelerator in Tauri's syntax: modifiers and one key, `+`-joined.
pub fn is_accel(a: &str) -> bool {
    const MODS: &[&str] = &["CmdOrCtrl", "Cmd", "Ctrl", "Alt", "Option", "Shift", "Super"];
    let parts: Vec<&str> = a.split('+').collect();
    let (key, mods) = parts.split_last().map(|(k, m)| (*k, m)).unwrap_or(("", &[]));
    a.len() <= 40 && mods.iter().all(|m| MODS.contains(m)) && (key.len() == 1 && key.chars().all(|c| c.is_ascii_alphanumeric()) || matches!(key, "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12" | "Enter" | "Space" | "Tab" | "," | "."))
}

/// A label as the menu shows it: trimmed, no control or bidi-override characters
/// (a page could otherwise make one item read as another), at most 80 characters.
/// On Windows `&` marks a mnemonic, so a literal one is doubled there.
pub fn clean_label(label: &str, windows: bool) -> Result<String, String> {
    let l = label.trim();
    if l.is_empty() {
        return Err("an empty label".into());
    }
    if l.chars().count() > MAX_LABEL {
        return Err(format!("a label longer than {MAX_LABEL} characters"));
    }
    if l.chars().any(|c| c.is_control() || matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')) {
        return Err("a label with control or bidi-override characters".into());
    }
    Ok(if windows { l.replace('&', "&&") } else { l.to_string() })
}

/// Check the menu and fit it to the platform: macOS-only roles leave the other
/// systems' menus, a separator never starts, ends or doubles, an empty section goes.
pub fn validate(sections: Vec<Section>, macos: bool, windows: bool) -> Result<Vec<Section>, String> {
    if sections.len() > MAX_SECTIONS {
        return Err(format!("more than {MAX_SECTIONS} menus"));
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for s in sections {
        if !matches!(s.id.as_str(), "app" | "file" | "edit" | "view" | "window" | "help") {
            return Err(format!("an unknown menu '{}'", s.id));
        }
        if s.id == "app" && !macos {
            continue;
        }
        if s.items.len() > MAX_ITEMS {
            return Err(format!("more than {MAX_ITEMS} items in '{}'", s.id));
        }
        let label = clean_label(&s.label, windows)?;
        let mut items: Vec<Entry> = Vec::new();
        for e in s.items {
            let e = match e {
                Entry::Separator => Entry::Separator,
                Entry::Role { role, label } => {
                    if !ROLES.contains(&role.as_str()) {
                        return Err(format!("an unknown system item '{role}'"));
                    }
                    if !macos && MAC_ONLY_ROLES.contains(&role.as_str()) {
                        continue;
                    }
                    Entry::Role { label: clean_label(&label, windows)?, role }
                }
                Entry::Command { id, label, accel } => {
                    if !is_command_id(&id) {
                        return Err(format!("'{id}' is not a command id"));
                    }
                    if !seen.insert(id.clone()) {
                        return Err(format!("'{id}' is in the menu twice"));
                    }
                    if let Some(a) = &accel {
                        if !is_accel(a) {
                            return Err(format!("'{a}' is not a shortcut"));
                        }
                    }
                    Entry::Command { label: clean_label(&label, windows)?, id, accel }
                }
            };
            if e == Entry::Separator && matches!(items.last(), None | Some(Entry::Separator)) {
                continue;
            }
            items.push(e);
        }
        while items.last() == Some(&Entry::Separator) {
            items.pop();
        }
        if !items.is_empty() {
            out.push(Section { id: s.id, label, items });
        }
    }
    Ok(out)
}

/// A `lumen-menu` id the shell forwards to the WebView: only a command id that is in the menu.
pub fn forwardable(sections: &[Section], id: &str) -> bool {
    sections.iter().any(|s| s.items.iter().any(|e| matches!(e, Entry::Command { id: i, .. } if i == id)))
}
