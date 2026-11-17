// Siri, Spotlight and the Shortcuts app (plan W3.4): App Intents.
//
// - "Add to inbox" runs without opening Lumen and without the WebView: the
//   text is queued in the App Group (CaptureQueue, plan W11.P8) and added to
//   inbox.md the next time the app starts or comes to the front, with the
//   time it was said.
// - "Capture to inbox" opens the native capture sheet (NativeCapture.swift)
//   at once, before the WebView has loaded; the Control Center button and the
//   Lock Screen widget run it (LumenWidgets/LumenControls.swift).
// - The others open the app on an action link (lumen://…), which the WebView
//   handles like a widget tap.
//
// App Shortcuts (below) put them in Spotlight and Siri with no setup, in
// English and Hebrew (AppShortcuts.strings in en.lproj / he.lproj).

import AppIntents
import Foundation

@available(iOS 16.0, *)
struct AddToInboxIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Lumen inbox"
    static var description = IntentDescription("Adds text to the end of inbox.md in Lumen.")
    static var openAppWhenRun = false

    @Parameter(title: "Text", requestValueDialog: "What should I add?")
    var text: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try CaptureQueue.addText(text, source: "siri")
        return .result(dialog: "Added to your Lumen inbox.")
    }
}

/// Opens the native capture sheet: typing starts before the WebView has loaded.
@available(iOS 16.0, *)
struct CaptureSheetIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture to Lumen inbox"
    static var description = IntentDescription("Opens a box to type a line for inbox.md, before the rest of Lumen loads.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        NativeCapture.present(source: "shortcut")
        return .result()
    }
}

@available(iOS 16.0, *)
struct QuickNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Quick note in Lumen"
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LumenLaunch.deliver(URL(string: "lumen://capture")!)
        return .result()
    }
}

@available(iOS 16.0, *)
struct VoiceNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Voice note in Lumen"
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LumenLaunch.deliver(URL(string: "lumen://capture?mode=voice")!)
        return .result()
    }
}

/// Plan W10.C31: "Record to inbox" — the Lock Screen, Action button and Siri start a voice note that lands in the inbox.
@available(iOS 16.0, *)
struct RecordToInboxIntent: AppIntent {
    static var title: LocalizedStringResource = "Record to Lumen inbox"
    static var description = IntentDescription("Opens Lumen recording a voice note into the inbox.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LumenLaunch.deliver(URL(string: "lumen://capture?mode=voice")!)
        return .result()
    }
}

@available(iOS 16.0, *)
struct SearchNotesIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Lumen"
    static var openAppWhenRun = true

    @Parameter(title: "Search for")
    var query: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        var c = URLComponents(string: "lumen://search")!
        if let q = query, !q.isEmpty { c.queryItems = [URLQueryItem(name: "q", value: q)] }
        LumenLaunch.deliver(c.url!)
        return .result()
    }
}

@available(iOS 16.0, *)
struct DailyNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Today's note in Lumen"
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LumenLaunch.deliver(URL(string: "lumen://daily")!)
        return .result()
    }
}

@available(iOS 16.0, *)
struct LumenShortcuts: AppShortcutsProvider {
    // Every phrase must contain the app name (Apple's rule).
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddToInboxIntent(), phrases: ["Add to \(.applicationName) inbox", "Add to my \(.applicationName) inbox"], shortTitle: "Add to inbox", systemImageName: "tray.and.arrow.down")
        AppShortcut(intent: CaptureSheetIntent(), phrases: ["Capture to \(.applicationName)", "Capture to my \(.applicationName) inbox"], shortTitle: "Capture", systemImageName: "tray.and.arrow.down.fill")
        AppShortcut(intent: QuickNoteIntent(), phrases: ["Quick note in \(.applicationName)", "New \(.applicationName) note"], shortTitle: "Quick note", systemImageName: "square.and.pencil")
        AppShortcut(intent: VoiceNoteIntent(), phrases: ["Voice note in \(.applicationName)"], shortTitle: "Voice note", systemImageName: "mic")
        AppShortcut(intent: RecordToInboxIntent(), phrases: ["Record to \(.applicationName) inbox", "Record a \(.applicationName) voice note"], shortTitle: "Record to inbox", systemImageName: "mic.badge.plus")
        AppShortcut(intent: SearchNotesIntent(), phrases: ["Search \(.applicationName)"], shortTitle: "Search", systemImageName: "magnifyingglass")
        AppShortcut(intent: DailyNoteIntent(), phrases: ["Today's \(.applicationName) note", "Open today in \(.applicationName)"], shortTitle: "Today's note", systemImageName: "calendar")
    }
}
