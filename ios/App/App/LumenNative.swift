// Widgets, Shortcuts and Siri (plan W3.4): the native half of the seam in
// src/mobile/nativeActions.ts. Everything that starts outside the app —
// a widget button, a Siri / Spotlight App Intent, a lumen:// link — ends here
// as an action link for the WebView, or as a queued capture.
//
// Nothing here decides what an action means; the WebView does (and tests it).

import Capacitor
import Foundation
import UIKit

/// Links that arrived before the WebView was ready, and the latest one.
enum LumenLaunch {
    static var pending: String?

    /// Stamp the time the app received the link (`t`, ms since epoch) so the
    /// WebView can log arrival → cursor (the widget's own tap time isn't knowable).
    static func stamped(_ url: URL) -> String {
        guard var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
        var items = (c.queryItems ?? []).filter { $0.name != "t" }
        items.append(URLQueryItem(name: "t", value: String(Int64(Date().timeIntervalSince1970 * 1000))))
        c.queryItems = items
        return c.url?.absoluteString ?? url.absoluteString
    }

    /// Hand a link to the WebView: now if it listens, else on `getLaunchUrl`.
    static func deliver(_ url: URL) {
        guard url.scheme == "lumen" else { return }
        let s = stamped(url)
        pending = s
        NotificationCenter.default.post(name: .lumenAction, object: nil, userInfo: ["url": s])
    }
}

extension Notification.Name {
    static let lumenAction = Notification.Name("lumen:action")
}

/// The queue the WebView drains: since W11.P8 it is CaptureQueue, in the App
/// Group, so the share sheet and the native capture sheet write to the same
/// place as "Add to inbox". The old UserDefaults list is moved over once.
enum PendingCaptures {
    static func all() -> [[String: String]] {
        CaptureQueue.migrateLegacy()
        return CaptureQueue.dictionaries()
    }

    static func add(_ text: String, source: String = "siri") {
        _ = try? CaptureQueue.addText(text, source: source)
    }

    static func remove(_ ids: [String]) {
        CaptureQueue.remove(ids)
    }
}

/// The Capacitor plugin the WebView calls `LumenNative`.
@objc(LumenNativePlugin)
public class LumenNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LumenNativePlugin"
    public let jsName = "LumenNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLaunchUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingCaptures", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeCaptures", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureFile", returnType: CAPPluginReturnPromise),
        // W13.Y4: the system text size (Dynamic Type) as a scale of the default.
        CAPPluginMethod(name: "getTextScale", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(onAction(_:)), name: .lumenAction, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(onResume), name: UIApplication.didBecomeActiveNotification, object: nil)
        // The native capture sheet saved while the app is open: drain now, not on the next resume.
        NotificationCenter.default.addObserver(self, selector: #selector(onResume), name: CaptureQueue.changed, object: nil)
    }

    @objc func onAction(_ n: Notification) {
        guard let url = n.userInfo?["url"] as? String else { return }
        LumenLaunch.pending = nil
        notifyListeners("url", data: ["url": url])
    }

    @objc func onResume() {
        notifyListeners("resume", data: [:])
    }

    /// W13.Y4 (EN 301 549 v4.1.1 user preferences): Dynamic Type as a scale —
    /// the body style's size at the user's content size category over its
    /// size at the default (17 pt), e.g. 1.0 at Large, about 3.1 at AX5.
    @objc func getTextScale(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let scaled = UIFontMetrics(forTextStyle: .body).scaledValue(for: 17, compatibleWith: UITraitCollection(preferredContentSizeCategory: UIApplication.shared.preferredContentSizeCategory))
            call.resolve(["scale": Double(scaled / 17), "category": UIApplication.shared.preferredContentSizeCategory.rawValue])
        }
    }

    @objc func getLaunchUrl(_ call: CAPPluginCall) {
        let url = LumenLaunch.pending
        LumenLaunch.pending = nil
        call.resolve(["url": url as Any])
    }

    @objc func pendingCaptures(_ call: CAPPluginCall) {
        call.resolve(["items": PendingCaptures.all()])
    }

    @objc func removeCaptures(_ call: CAPPluginCall) {
        PendingCaptures.remove(call.getArray("ids", String.self) ?? [])
        call.resolve()
    }

    /// A queued image or PDF, as base64 (`file` is the stored name from `pendingCaptures`).
    @objc func captureFile(_ call: CAPPluginCall) {
        guard let name = call.getString("file"), let data = CaptureQueue.fileData(name) else {
            call.reject("no such capture file")
            return
        }
        call.resolve(["data": data.base64EncodedString()])
    }
}

/// Registers the app's own plugin (Capacitor loads npm plugins by itself;
/// a plugin inside the app target is registered here). Main.storyboard
/// uses this class instead of CAPBridgeViewController.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LumenNativePlugin())
        // Plan W2.19 (W10.E45): LAN discovery for pairing without a code (LanDiscovery.swift).
        bridge?.registerPluginInstance(LumenLanPlugin())
    }
}
