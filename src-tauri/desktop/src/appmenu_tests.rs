use crate::appmenu::{self, Entry, Section};

fn cmd(id: &str, label: &str, accel: Option<&str>) -> Entry {
    Entry::Command { id: id.into(), label: label.into(), accel: accel.map(Into::into) }
}
fn role(r: &str, label: &str) -> Entry {
    Entry::Role { role: r.into(), label: label.into() }
}
fn sec(id: &str, label: &str, items: Vec<Entry>) -> Section {
    Section { id: id.into(), label: label.into(), items }
}

#[test]
fn hebrew_menu_passes_and_keeps_its_order() {
    let m = vec![
        sec("app", "Lumen", vec![role("about", "אודות Lumen"), Entry::Separator, role("services", "שירותים"), Entry::Separator, role("quit", "יציאה מ-Lumen")]),
        sec("file", "קובץ", vec![cmd("file.new", "פתק חדש", Some("CmdOrCtrl+N")), Entry::Separator, cmd("file.save", "שמירה", Some("CmdOrCtrl+S"))]),
        sec("edit", "עריכה", vec![role("undo", "ביטול"), role("copy", "העתקה")]),
    ];
    let mac = appmenu::validate(m.clone(), true, false).unwrap();
    assert_eq!(mac, m);
    // Elsewhere: no application menu, no Services.
    let win = appmenu::validate(m, false, true).unwrap();
    assert_eq!(win.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["file", "edit"]);
}

#[test]
fn mac_only_roles_leave_other_menus_and_separators_tidy() {
    let m = vec![sec("window", "Window", vec![Entry::Separator, role("hide", "Hide"), Entry::Separator, Entry::Separator, role("minimize", "Minimize"), Entry::Separator])];
    let out = appmenu::validate(m, false, false).unwrap();
    assert_eq!(out[0].items, vec![role("minimize", "Minimize")]);
}

#[test]
fn refuses_what_the_palette_cannot_do() {
    let bad = |items: Vec<Entry>| appmenu::validate(vec![sec("file", "File", items)], true, false);
    assert!(bad(vec![cmd("../../etc", "x", None)]).is_err());
    assert!(bad(vec![cmd("file", "x", None)]).is_err());
    assert!(bad(vec![role("shell", "x")]).is_err());
    assert!(bad(vec![cmd("file.new", "a", None), cmd("file.new", "b", None)]).is_err());
    assert!(bad(vec![cmd("file.new", "x", Some("CmdOrCtrl+Delete+Q"))]).is_err());
    assert!(bad(vec![cmd("file.new", "  ", None)]).is_err());
    // A bidi override could make one item read as another.
    assert!(bad(vec![cmd("file.new", "\u{202E}evaS", None)]).is_err());
    assert!(bad(vec![cmd("file.new", &"א".repeat(81), None)]).is_err());
    assert!(appmenu::validate(vec![sec("tools", "x", vec![])], true, false).is_err());
}

#[test]
fn windows_doubles_a_literal_ampersand() {
    let out = appmenu::validate(vec![sec("help", "Help & Tips", vec![cmd("help.open", "Q&A", None)])], false, true).unwrap();
    assert_eq!(out[0].label, "Help && Tips");
    assert_eq!(out[0].items[0], cmd("help.open", "Q&&A", None));
}

#[test]
fn only_menu_commands_are_forwarded() {
    let m = appmenu::validate(vec![sec("file", "File", vec![cmd("file.new", "New", None), role("copy", "Copy")])], true, false).unwrap();
    assert!(appmenu::forwardable(&m, "file.new"));
    assert!(!appmenu::forwardable(&m, "vault.encrypt"));
    assert!(!appmenu::forwardable(&m, "copy"));
}
