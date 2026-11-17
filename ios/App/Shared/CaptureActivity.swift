// The capture Live Activity (plan W13.M2): shared by the app, which starts,
// updates and ends it (ActivityKit), and the widget extension, which draws
// it on the Lock Screen and in the Dynamic Island. Like Obsidian 1.14, it
// keeps an open capture one tap away while you do something else.
//
// It carries no note text: only whether the box is open or recording, and
// since when (the system draws the running clock, so no updates are pushed).

import ActivityKit
import AppIntents
import Foundation

@available(iOS 16.1, *)
struct CaptureActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// "capture" (the box is open) or "recording" (a voice note).
        var mode: String
        /// When this mode began: the clock counts from here.
        var since: Date
    }
}

extension Notification.Name {
    /// The Live Activity's Stop button was pressed (StopCaptureIntent, in the app's process).
    static let lumenCaptureStop = Notification.Name("lumen:capture-stop")
}

/// The Stop button on the Lock Screen and in the expanded Dynamic Island.
/// A LiveActivityIntent runs in the app's process, so it reaches the WebView.
@available(iOS 17.0, *)
struct StopCaptureIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "live.stop"
    static var isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        await MainActor.run { NotificationCenter.default.post(name: .lumenCaptureStop, object: nil) }
        return .result()
    }
}
