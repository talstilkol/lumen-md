// The native capture sheet (plan W11.P8): a text box over the app that opens
// at once from the Control Center button, the Lock Screen widget or the
// "Capture to inbox" shortcut, while the WebView may still be loading.
// Save writes to CaptureQueue (the App Group); the WebView adds the line to
// inbox.md when it is ready (it is told through CaptureQueue.changed).
//
// The layout follows the system language: in Hebrew the text and the buttons
// run right to left (natural alignment, leading/trailing bar items).

import UIKit

enum NativeCapture {
    /// `lumen://capture?native=1&source=…` opens the sheet instead of the WebView's box.
    static func handles(_ url: URL) -> Bool {
        guard url.scheme == "lumen", (url.host ?? "").lowercased() == "capture" else { return false }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return q.contains { $0.name == "native" && $0.value == "1" }
    }

    static func source(of url: URL) -> String {
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let s = q.first { $0.name == "source" }?.value ?? "control"
        return ["control", "lockscreen", "shortcut", "widget"].contains(s) ? s : "control"
    }

    @MainActor
    static func present(source: String, attempt: Int = 0) {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let root = UIApplication.shared.delegate?.window??.rootViewController
            ?? scenes.flatMap({ $0.windows }).first(where: { $0.isKeyWindow })?.rootViewController
        guard let root = root else {
            // No window yet (a cold start): try again shortly, for up to 2 s.
            if attempt < 20 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { present(source: source, attempt: attempt + 1) } }
            return
        }
        var top = root
        while let p = top.presentedViewController { top = p }
        if top is UINavigationController, (top as? UINavigationController)?.viewControllers.first is NativeCaptureController { return }
        let nav = UINavigationController(rootViewController: NativeCaptureController(source: source))
        nav.modalPresentationStyle = .formSheet
        if let sheet = nav.sheetPresentationController { sheet.detents = [.medium(), .large()] }
        top.present(nav, animated: true)
    }
}

final class NativeCaptureController: UIViewController {
    private let source: String
    private let text = UITextView()

    init(source: String) {
        self.source = source
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = NSLocalizedString("capture.title", comment: "")
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: NSLocalizedString("capture.cancel", comment: ""), style: .plain, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: NSLocalizedString("capture.save", comment: ""), style: .done, target: self, action: #selector(save))
        text.font = .preferredFont(forTextStyle: .body)
        text.adjustsFontForContentSizeCategory = true
        text.textAlignment = .natural
        text.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(text)
        NSLayoutConstraint.activate([
            text.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            text.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            text.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            text.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -8),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        text.becomeFirstResponder()
    }

    @objc private func cancel() {
        dismiss(animated: true)
    }

    @objc private func save() {
        do {
            if try CaptureQueue.addText(text.text, source: source) != nil {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                UIAccessibility.post(notification: .announcement, argument: NSLocalizedString("capture.saved", comment: ""))
            }
            dismiss(animated: true)
        } catch {
            // Keep the text in the box: nothing typed is thrown away.
            let alert = UIAlertController(title: NSLocalizedString("capture.failed", comment: ""), message: nil, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            present(alert, animated: true)
        }
    }
}
