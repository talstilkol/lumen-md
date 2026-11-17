// Starts, updates and ends the capture Live Activity (plan W13.M2) for the
// WebView (LumenNative.startCaptureActivity / updateCaptureActivity /
// endCaptureActivity). One activity at a time; nothing when the person has
// Live Activities off. It ends by itself when the capture is saved or the
// box closes, and after 8 hours at most (the system's limit).

import ActivityKit
import Foundation

enum LiveCapture {
    static func start(mode: String, since: Date) -> String? {
        guard #available(iOS 16.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
        let state = CaptureActivityAttributes.ContentState(mode: mode, since: since)
        if let current = Activity<CaptureActivityAttributes>.activities.first {
            Task { await current.update(ActivityContent(state: state, staleDate: nil)) }
            return current.id
        }
        do {
            let a = try Activity.request(attributes: CaptureActivityAttributes(), content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(8 * 3600)), pushType: nil)
            return a.id
        } catch {
            return nil
        }
    }

    static func update(mode: String, since: Date) {
        guard #available(iOS 16.2, *) else { return }
        let state = CaptureActivityAttributes.ContentState(mode: mode, since: since)
        for a in Activity<CaptureActivityAttributes>.activities {
            Task { await a.update(ActivityContent(state: state, staleDate: nil)) }
        }
    }

    /// End every capture activity; `saved` lets the banner linger a moment, a cancel removes it at once.
    static func end(saved: Bool) {
        guard #available(iOS 16.2, *) else { return }
        for a in Activity<CaptureActivityAttributes>.activities {
            Task { await a.end(nil, dismissalPolicy: saved ? .after(Date().addingTimeInterval(4)) : .immediate) }
        }
    }
}
