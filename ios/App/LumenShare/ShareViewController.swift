// The share sheet (plan W11.P9): our own Share Extension, not a third-party
// plugin. Text, a link, images and PDFs shared from any app go to the App
// Group capture queue (Shared/CaptureQueue.swift) with where they came from,
// and from there to inbox.md the next time Lumen is in front. The app is not
// opened and the WebView is not needed: sharing works while Lumen is closed.
//
// The queue entry carries the source: `source` is "share"; a link keeps its
// URL and the page title the sharing app gave; a file keeps its original name
// and type. (iOS does not tell an extension which app shared, so no app name.)

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let status = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        status.text = NSLocalizedString("share.saving", comment: "")
        status.textAlignment = .natural
        status.font = .preferredFont(forTextStyle: .headline)
        status.adjustsFontForContentSizeCategory = true
        status.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(status)
        NSLayoutConstraint.activate([
            status.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            status.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            status.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await saveAll() }
    }

    private func saveAll() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var saved = 0
        var failed = 0
        for item in items {
            let title = item.attributedContentText?.string ?? item.attributedTitle?.string ?? ""
            for provider in item.attachments ?? [] {
                do {
                    if try await save(provider, title: title) { saved += 1 }
                } catch {
                    failed += 1
                }
            }
        }
        await MainActor.run {
            status.text = NSLocalizedString(failed > 0 ? "share.failed" : saved > 0 ? "share.saved" : "share.nothing", comment: "")
            UIAccessibility.post(notification: .announcement, argument: status.text)
        }
        try? await Task.sleep(nanoseconds: 700_000_000)
        await MainActor.run {
            if failed > 0 && saved == 0 {
                extensionContext?.cancelRequest(withError: CocoaError(.fileWriteUnknown))
            } else {
                extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }

    /// One attachment → one queued capture. A PDF or an image before a URL: Safari shares a page's URL alongside.
    private func save(_ p: NSItemProvider, title: String) async throws -> Bool {
        if p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            return try await saveFile(p, type: .pdf, kind: "pdf", caption: title)
        }
        if p.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            return try await saveFile(p, type: .image, kind: "image", caption: title)
        }
        if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            let item = try await p.loadItem(forTypeIdentifier: UTType.url.identifier)
            guard let url = (item as? URL) ?? (item as? String).flatMap(URL.init(string:)) else { return false }
            if url.isFileURL {
                let type = UTType(filenameExtension: url.pathExtension)
                if type?.conforms(to: .pdf) == true { try CaptureQueue.addFile(from: url, kind: "pdf", mime: "application/pdf", caption: title, source: "share"); return true }
                if let t = type, t.conforms(to: .image) { try CaptureQueue.addFile(from: url, kind: "image", mime: t.preferredMIMEType ?? "image/jpeg", caption: title, source: "share"); return true }
                return false
            }
            try CaptureQueue.addLink(url, title: title, source: "share")
            return true
        }
        if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let item = try await p.loadItem(forTypeIdentifier: UTType.plainText.identifier)
            guard let text = (item as? String) ?? (item as? Data).flatMap({ String(data: $0, encoding: .utf8) }) else { return false }
            return try CaptureQueue.addText(text, source: "share") != nil
        }
        return false
    }

    /// The system hands a temporary copy that is deleted when the callback returns: copy it into the queue inside the callback.
    private func saveFile(_ p: NSItemProvider, type: UTType, kind: String, caption: String) async throws -> Bool {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Bool, Error>) in
            _ = p.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                guard let url = url else {
                    cont.resume(throwing: error ?? CocoaError(.fileReadUnknown))
                    return
                }
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? (kind == "pdf" ? "application/pdf" : "image/jpeg")
                do {
                    try CaptureQueue.addFile(from: url, kind: kind, mime: mime, caption: caption, source: "share")
                    cont.resume(returning: true)
                } catch {
                    cont.resume(throwing: error)
                }
            }
        }
    }
}
