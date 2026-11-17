// Generated from src/lib/shortcuts.ts by src/mobile/keyCommands.ts (plan W13.M5).
// Do not edit: UPDATE_IOS_KEYS=1 npx vitest run src/__tests__/ipadKeyCommands.test.ts

import UIKit

extension LumenKeyCommands {
    static let all: [Spec] = [
        .init(id: "view.focusMode", input: "f", modifiers: [.command, .shift], menu: .view, en: "Focus mode", he: "מצב פוקוס"),
        .init(id: "insert.smart", input: "v", modifiers: [.command, .shift], menu: .go, en: "Smart paste", he: "הדבקה חכמה"),
        .init(id: "file.saveAs", input: "s", modifiers: [.command, .shift], menu: .file, en: "Save as…", he: "שמירה בשם…"),
        .init(id: "palette.toggle", input: "k", modifiers: [.command], menu: .go, en: "Command palette", he: "פלטת פקודות"),
        .init(id: "file.save", input: "s", modifiers: [.command], menu: .file, en: "Save", he: "שמירה"),
        .init(id: "view.findReplace", input: "h", modifiers: [.command], menu: .view, en: "Find & Replace", he: "חיפוש והחלפה"),
        .init(id: "file.open", input: "o", modifiers: [.command], menu: .file, en: "Open file…", he: "פתח קובץ…"),
        .init(id: "file.new", input: "n", modifiers: [.command], menu: .file, en: "New document", he: "מסמך חדש"),
        .init(id: "view.source", input: "1", modifiers: [.command], menu: .view, en: "Source only", he: "קוד בלבד"),
        .init(id: "view.split", input: "2", modifiers: [.command], menu: .view, en: "Split editor + preview", he: "עורך + תצוגה מקדימה"),
        .init(id: "view.preview", input: "3", modifiers: [.command], menu: .view, en: "Preview only", he: "תצוגה מקדימה בלבד"),
        .init(id: "view.wysiwyg", input: "4", modifiers: [.command], menu: .view, en: "WYSIWYG", he: "WYSIWYG"),
        .init(id: "help.shortcuts", input: "/", modifiers: [.command], menu: .help, en: "Keyboard shortcuts", he: "קיצורי מקלדת"),
        .init(id: "note.today", input: "d", modifiers: [.command, .alternate], menu: .go, en: "Today's note", he: "הפתק של היום"),
        .init(id: "note.capture", input: "n", modifiers: [.command, .alternate], menu: .file, en: "Quick capture", he: "לכידה מהירה"),
        .init(id: "cite.insert", input: "c", modifiers: [.command, .alternate], menu: .go, en: "Insert a citation [@key]…", he: "הוספת ציטוט ‎[@key]…"),
        .init(id: "sources.open", input: "s", modifiers: [.command, .alternate], menu: .go, en: "Open sources…", he: "מקורות פתוחים…"),
        .init(id: "help.open", input: "F1", modifiers: [], menu: .help, en: "Help", he: "עזרה"),
        .init(id: "window.new", input: "n", modifiers: [.command, .shift], menu: .file, en: "New window", he: "חלון חדש"),
        .init(id: "tab.close", input: "w", modifiers: [.command], menu: .file, en: "Close tab", he: "סגירת לשונית"),
    ]
}
