// iPad windows (plan W13.M5): the app runs in UIScenes, so iPadOS 26 can
// show it in several windows (Stage Manager, Split View), each with its own
// WebView and its own note. A window opened for a note (LumenNative.openWindow,
// or "Open in New Window" from a dragged note) carries the note's vault path
// in its user activity; the WebView of that window alone opens it.

import Capacitor
import CoreSpotlight
import UIKit

enum LumenWindows {
    /// The user activity of a window for one note.
    static let activityType = "com.lumen.editor.window"

    static func activity(note: String?) -> NSUserActivity {
        let a = NSUserActivity(activityType: activityType)
        a.title = note
        if let note = note { a.userInfo = ["note": note] }
        a.targetContentIdentifier = note
        return a
    }

    /// The lumen://open link for a note path (built with URLComponents, so the path is encoded).
    static func openLink(_ note: String) -> String? {
        var c = URLComponents()
        c.scheme = "lumen"
        c.host = "open"
        c.queryItems = [URLQueryItem(name: "path", value: note)]
        return c.url?.absoluteString
    }

    /// A new window, for a note or empty. Only where the device has several windows (iPad).
    static func open(note: String?) {
        guard UIApplication.shared.supportsMultipleScenes else { return }
        UIApplication.shared.requestSceneSessionActivation(nil, userActivity: activity(note: note), options: nil, errorHandler: nil)
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // The window and Main.storyboard's MainViewController come from the scene manifest (Info.plist).
        let activity = connectionOptions.userActivities.first(where: { $0.activityType == LumenWindows.activityType }) ?? session.stateRestorationActivity
        if let note = activity?.userInfo?["note"] as? String, let link = LumenWindows.openLink(note) {
            (window?.rootViewController as? MainViewController)?.launchLink = link
            session.userInfo = ["note": note]
        }
        for c in connectionOptions.urlContexts { route(c.url) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for c in URLContexts { route(c.url) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // W13.M3: a note found in Spotlight (before iOS 18: a CSSearchableItem) opens in this window.
        if userActivity.activityType == CSSearchableItemActionType,
           let path = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
           let url = NoteStore.openURL(path) {
            LumenLaunch.deliver(url)
            return
        }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

    /// The same routing AppDelegate does for links when the app has no scenes.
    private func route(_ url: URL) {
        if NativeCapture.handles(url) {
            NativeCapture.present(source: NativeCapture.source(of: url))
        } else if url.scheme == "lumen" {
            LumenLaunch.deliver(url)
        } else {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        (UIApplication.shared.delegate as? AppDelegate)?.checkForSharedNote()
    }

    /// Restores a note's window with its note after the system ends the session.
    func stateRestorationActivity(for scene: UIScene) -> NSUserActivity? {
        guard let note = (scene.session.userInfo?["note"] as? String) else { return nil }
        return LumenWindows.activity(note: note)
    }
}
