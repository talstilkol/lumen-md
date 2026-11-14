// The capture queue (plans W11.P8, W11.P9): what is captured outside the
// WebView waits here until the app adds it to inbox.md.
//
// Compiled into two targets, so it lives in the App Group container:
// - App: "Add to inbox" (Siri / Shortcuts), and the native capture sheet that
//   the Control Center button and the Lock Screen widget open;
// - LumenShare: the share sheet (text, links, images, PDFs).
//
// Every capture is its own JSON file, written to a temporary file and renamed
// into place (`.atomic`). A kill during the write leaves at most a temporary
// file that nobody lists; after the rename the capture is complete. There is
// no read-modify-write of a shared list, so two writers (the share sheet and
// Siri at once) can't drop each other's captures.
// An image or PDF is copied in first; its JSON file, written last, is the
// commit point.
//
// The WebView lists the queue, adds each capture to the inbox, records the id
// in its own journal, and only then asks for it to be removed
// (src/mobile/captureQueue.ts). Nothing is lost if it is killed at any step.

import Foundation

struct QueuedCapture: Codable, Equatable {
    /// "text", "url", "image" or "pdf".
    var kind: String
    var id: String
    var text: String
    /// ISO 8601, when it was captured.
    var at: String
    /// Where it came from: "siri", "control", "lockscreen", "share", "legacy".
    var source: String
    /// The shared link (kind "url"), or the web page an image came from.
    var url: String?
    /// The file's name inside Captures/files (kind "image" / "pdf").
    var file: String?
    var mime: String?
    /// The file's original name, as the sharing app gave it.
    var name: String?
}

enum CaptureQueue {
    static let group = "group.com.lumen.editor"
    static let maxText = 8192
    static let maxItems = 500
    static let maxFileBytes = 25 * 1024 * 1024
    /// Written by the share sheet / intents, read by the app on resume.
    static let changed = Notification.Name("lumen:capturesChanged")

    static func directory(_ fm: FileManager = .default) -> URL? {
        fm.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("Captures", isDirectory: true)
    }

    private static func ensure(_ dir: URL) throws {
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("files", isDirectory: true), withIntermediateDirectories: true)
    }

    static func now() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }

    /// The file name sorts by capture time, so the queue reads oldest first.
    private static func fileName(_ c: QueuedCapture) -> String {
        let ms = Int64(Date().timeIntervalSince1970 * 1000)
        return String(format: "%013lld", ms) + "-" + c.id + ".json"
    }

    /// Add one capture. Throws when the queue is full or the container is missing (no App Group).
    @discardableResult
    static func add(_ c: QueuedCapture, in dir: URL? = directory()) throws -> QueuedCapture {
        guard let dir = dir else { throw CocoaError(.fileNoSuchFile) }
        try ensure(dir)
        if list(in: dir).count >= maxItems { throw CocoaError(.fileWriteOutOfSpace) }
        var c = c
        c.text = String(c.text.prefix(maxText))
        let data = try JSONEncoder().encode(c)
        // Readable after the first unlock, so a Lock Screen capture can be written while locked.
        try data.write(to: dir.appendingPathComponent(fileName(c)), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        NotificationCenter.default.post(name: changed, object: nil)
        return c
    }

    @discardableResult
    static func addText(_ text: String, source: String, in dir: URL? = directory()) throws -> QueuedCapture? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let isWebURL = URL(string: trimmed).map { ["http", "https"].contains($0.scheme?.lowercased() ?? "") } ?? false
        let isLink = isWebURL && !trimmed.contains(where: { $0.isWhitespace })
        return try add(QueuedCapture(kind: isLink ? "url" : "text", id: UUID().uuidString, text: isLink ? "" : trimmed, at: now(), source: source, url: isLink ? trimmed : nil), in: dir)
    }

    @discardableResult
    static func addLink(_ url: URL, title: String, source: String, in dir: URL? = directory()) throws -> QueuedCapture {
        try add(QueuedCapture(kind: "url", id: UUID().uuidString, text: title.trimmingCharacters(in: .whitespacesAndNewlines), at: now(), source: source, url: url.absoluteString), in: dir)
    }

    /// Copy a shared file in, then commit its capture. The copy is removed if the commit fails.
    @discardableResult
    static func addFile(from src: URL, kind: String, mime: String, caption: String, source: String, in dir: URL? = directory()) throws -> QueuedCapture {
        guard let dir = dir else { throw CocoaError(.fileNoSuchFile) }
        try ensure(dir)
        let size = (try? src.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > maxFileBytes { throw CocoaError(.fileWriteOutOfSpace) }
        let id = UUID().uuidString
        let ext = src.pathExtension.isEmpty ? (kind == "pdf" ? "pdf" : "jpg") : src.pathExtension.lowercased()
        let stored = "\(id).\(ext)"
        let dest = dir.appendingPathComponent("files", isDirectory: true).appendingPathComponent(stored)
        let data = try Data(contentsOf: src)
        try data.write(to: dest, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        do {
            return try add(QueuedCapture(kind: kind, id: id, text: caption, at: now(), source: source, url: nil, file: stored, mime: mime, name: src.lastPathComponent), in: dir)
        } catch {
            try? FileManager.default.removeItem(at: dest)
            throw error
        }
    }

    /// Every complete capture, oldest first. Temporary files and unreadable entries are skipped (and kept).
    static func list(in dir: URL? = directory()) -> [QueuedCapture] {
        guard let dir = dir, let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        return names.filter { $0.hasSuffix(".json") }.sorted().compactMap { name in
            guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
            return try? JSONDecoder().decode(QueuedCapture.self, from: data)
        }
    }

    /// The bytes of a queued file, by its stored name (no path: a name with "/" or ".." is refused).
    static func fileData(_ stored: String, in dir: URL? = directory()) -> Data? {
        guard let dir = dir, !stored.contains("/"), !stored.contains(".."), !stored.isEmpty else { return nil }
        return try? Data(contentsOf: dir.appendingPathComponent("files", isDirectory: true).appendingPathComponent(stored))
    }

    /// Remove captures the app has added (and journaled): the JSON first, then its file.
    static func remove(_ ids: [String], in dir: URL? = directory()) {
        guard let dir = dir, let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return }
        let drop = Set(ids)
        for name in names where name.hasSuffix(".json") {
            let url = dir.appendingPathComponent(name)
            guard let data = try? Data(contentsOf: url), let c = try? JSONDecoder().decode(QueuedCapture.self, from: data), drop.contains(c.id) else { continue }
            try? FileManager.default.removeItem(at: url)
            if let f = c.file, !f.contains("/") { try? FileManager.default.removeItem(at: dir.appendingPathComponent("files", isDirectory: true).appendingPathComponent(f)) }
        }
    }

    /// The queue before W11.P8 lived in the app's UserDefaults: move it over once, then forget the old key.
    static func migrateLegacy(_ d: UserDefaults = .standard, in dir: URL? = directory()) {
        let key = "lumen.pendingCaptures"
        guard let old = d.array(forKey: key) as? [[String: String]], !old.isEmpty else { return }
        for item in old {
            guard let id = item["id"], let text = item["text"], let at = item["at"] else { continue }
            _ = try? add(QueuedCapture(kind: "text", id: id, text: text, at: at, source: "legacy"), in: dir)
        }
        d.removeObject(forKey: key)
    }

    /// The JSON the WebView reads (`pendingCaptures`).
    static func dictionaries(in dir: URL? = directory()) -> [[String: String]] {
        list(in: dir).map { c in
            var d: [String: String] = ["id": c.id, "kind": c.kind, "text": c.text, "at": c.at, "source": c.source]
            if let v = c.url { d["url"] = v }
            if let v = c.file { d["file"] = v }
            if let v = c.mime { d["mime"] = v }
            if let v = c.name { d["name"] = v }
            return d
        }
    }
}
