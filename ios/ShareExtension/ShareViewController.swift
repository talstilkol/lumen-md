//
//  ShareViewController.swift
//  Lumen Share Extension
//
//  Allows users to share URLs or text from any app directly into a new Lumen note.
//

import UIKit
import Social
import MobileCoreServices

class ShareViewController: SLComposeServiceViewController {

    override func isContentValid() -> Bool {
        return true
    }

    override func didSelectPost() {
        // Extract shared content (URL or plain text)
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }

        var sharedText = ""
        var sharedURL = ""

        if let attachments = item.attachments {
            for attachment in attachments {
                if attachment.hasItemConformingToTypeIdentifier(kUTTypeURL as String) {
                    attachment.loadItem(forTypeIdentifier: kUTTypeURL as String, options: nil) { (url, error) in
                        if let url = url as? URL {
                            sharedURL = url.absoluteString
                        }
                    }
                } else if attachment.hasItemConformingToTypeIdentifier(kUTTypePlainText as String) {
                    attachment.loadItem(forTypeIdentifier: kUTTypePlainText as String, options: nil) { (text, error) in
                        if let text = text as? String {
                            sharedText = text
                        }
                    }
                }
            }
        }

        // Also check the text property directly
        if let text = item.attributedContent?.string, !text.isEmpty {
            sharedText = text
        }

        // Save to shared UserDefaults (App Group)
        let sharedDefaults = UserDefaults(suiteName: "group.com.lumen.editor")
        let noteContent = sharedURL.isEmpty ? sharedText : "[Shared link](\(sharedURL))\n\n\(sharedText)"
        sharedDefaults?.set(noteContent, forKey: "pendingSharedNote")
        sharedDefaults?.set(Date().timeIntervalSince1970, forKey: "pendingSharedNoteTimestamp")
        sharedDefaults?.synchronize()

        // Open the main app via URL scheme
        if let url = URL(string: "lumen://new-note?source=share") {
            _ = self.openURL(url)
        }

        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    override func configurationItems() -> [Any]! {
        return []
    }

    // Helper to open URL from extension (requires openURL override)
    @objc func openURL(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                return application.perform(#selector(UIApplication.open(_:options:completionHandler:)), with: url, with: [:]) != nil
            }
            responder = responder?.next
        }
        return false
    }
}
