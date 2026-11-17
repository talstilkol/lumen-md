// iPad keyboard shortcuts (plan W13.M5): every app-wide shortcut of the
// palette as a UIKeyCommand, so iPadOS lists it while ⌘ is held and in the
// menu bar (iPadOS 26), titled in the app's language. The table is
// generated (KeyCommandsData.swift, from src/lib/shortcuts.ts); a command
// hands its id to the WebView, which runs it as the same key press.

import UIKit
import WebKit

enum LumenKeyCommands {
    enum Menu { case file, view, go, help }

    struct Spec {
        let id: String
        let input: String
        let modifiers: UIKeyModifierFlags
        let menu: Menu
        let en: String
        let he: String
    }

    /// Hebrew when the app's language is Hebrew, else English.
    static var hebrew: Bool {
        (Bundle.main.preferredLocalizations.first ?? Locale.preferredLanguages.first ?? "en").hasPrefix("he")
    }

    static func title(_ s: Spec) -> String { hebrew ? s.he : s.en }

    static func input(_ s: Spec) -> String {
        switch s.input {
        case "F1": return UIKeyCommand.f1
        case "↑": return UIKeyCommand.inputUpArrow
        case "↓": return UIKeyCommand.inputDownArrow
        default: return s.input
        }
    }

    /// The commands, each calling `action` on the responder that holds them.
    static func commands(action: Selector) -> [UIKeyCommand] {
        all.map { s in
            let c = UIKeyCommand(title: title(s), action: action, input: input(s), modifierFlags: s.modifiers, propertyList: s.id)
            c.discoverabilityTitle = title(s)
            // ⌘W, ⌘N and ⌘O belong to the app while it is in front, not to the system.
            c.wantsPriorityOverSystemBehavior = true
            return c
        }
    }

    /// The iPadOS menu bar (and the ⌘ overlay): one menu per group, inserted into the system's.
    static func build(_ builder: UIMenuBuilder, action: Selector) {
        guard builder.system == .main else { return }
        let byMenu = Dictionary(grouping: all, by: { $0.menu })
        func menu(_ m: Menu, _ id: String) -> UIMenu {
            let cmds = (byMenu[m] ?? []).map { s -> UIKeyCommand in
                UIKeyCommand(title: title(s), action: action, input: input(s), modifierFlags: s.modifiers, propertyList: s.id)
            }
            return UIMenu(title: "", identifier: UIMenu.Identifier("com.lumen.editor.\(id)"), options: .displayInline, children: cmds)
        }
        builder.insertChild(menu(.file, "file"), atStartOfMenu: .file)
        builder.insertChild(menu(.view, "view"), atStartOfMenu: .view)
        builder.insertSibling(UIMenu(title: hebrew ? "מעבר" : "Go", children: [menu(.go, "go")]), afterMenu: .view)
        builder.insertChild(menu(.help, "help"), atStartOfMenu: .help)
    }

    /// Run a command in the WebView: the id is from the generated table, sent as JSON.
    static func run(_ id: String, in webView: WKWebView?) {
        guard all.contains(where: { $0.id == id }),
              let data = try? JSONSerialization.data(withJSONObject: ["id": id]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('lumen:key-command', { detail: \(json) }))")
    }
}
