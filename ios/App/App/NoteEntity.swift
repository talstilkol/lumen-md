// Notes in Spotlight and Siri (plan W13.M3). The WebView chooses which notes
// the system may know (src/mobile/spotlightIndex.ts: off by default; never a
// locked or private note) and sends their path, title and a short snippet
// (LumenNative.updateSpotlight). Here they become:
//
//   - NoteEntity, an App Entity: Siri and Shortcuts can name and open a note;
//   - on iOS 18+, IndexedEntity in CSSearchableIndex (Spotlight finds it, and
//     Apple Intelligence can refer to it); before 18, a CSSearchableItem;
//   - on iOS 26, an interactive snippet (NoteSnippetIntent): the note's title
//     and snippet in Spotlight, with Open.
// Opening one sends lumen://open?path=… to the WebView of the window that opens it.

import AppIntents
import CoreSpotlight
import Foundation
import SwiftUI

/// The notes the WebView allowed, kept in the app's own Application Support (not the App Group).
enum NoteStore {
    struct Note: Codable, Hashable {
        let path: String
        let title: String
        let snippet: String
        let modified: Double
    }

    static let domain = "com.lumen.editor.notes"

    private static var file: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("spotlight-notes.json")
    }

    static func all() -> [Note] {
        guard let f = file, let data = try? Data(contentsOf: f) else { return [] }
        return (try? JSONDecoder().decode([Note].self, from: data)) ?? []
    }

    static func save(_ notes: [Note]) {
        guard let f = file else { return }
        try? FileManager.default.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(notes) { try? data.write(to: f, options: [.atomic, .completeFileProtection]) }
    }

    /// Apply a sync from the WebView, and mirror it into the system index.
    static func apply(upsert: [Note], remove: [String], reset: Bool) {
        var byPath = reset ? [:] : Dictionary(all().map { ($0.path, $0) }, uniquingKeysWith: { a, _ in a })
        for p in remove { byPath.removeValue(forKey: p) }
        for n in upsert { byPath[n.path] = n }
        save(Array(byPath.values))
        let index = CSSearchableIndex.default()
        if #available(iOS 18.0, *) {
            if reset { index.deleteAppEntities(ofType: NoteEntity.self) }
            if !remove.isEmpty { index.deleteAppEntities(identifiedBy: remove, ofType: NoteEntity.self) }
            if !upsert.isEmpty { index.indexAppEntities(upsert.map(NoteEntity.init)) }
        } else {
            if reset { index.deleteSearchableItems(withDomainIdentifiers: [domain]) }
            if !remove.isEmpty { index.deleteSearchableItems(withIdentifiers: remove) }
            let items = upsert.map { n -> CSSearchableItem in
                let a = CSSearchableItemAttributeSet(contentType: .text)
                a.title = n.title
                a.contentDescription = n.snippet
                a.contentModificationDate = Date(timeIntervalSince1970: n.modified / 1000)
                return CSSearchableItem(uniqueIdentifier: n.path, domainIdentifier: domain, attributeSet: a)
            }
            if !items.isEmpty { index.indexSearchableItems(items) }
        }
    }

    /// The lumen://open link of a note (the path is encoded by URLComponents).
    static func openURL(_ path: String) -> URL? {
        var c = URLComponents()
        c.scheme = "lumen"
        c.host = "open"
        c.queryItems = [URLQueryItem(name: "path", value: path)]
        return c.url
    }
}

@available(iOS 16.0, *)
struct NoteEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "spotlight.note"
    static var defaultQuery = NoteQuery()

    var id: String
    var title: String
    var snippet: String

    init(_ n: NoteStore.Note) {
        id = n.path
        title = n.title
        snippet = n.snippet
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(snippet)", image: .init(systemName: "doc.text"))
    }
}

@available(iOS 18.0, *)
extension NoteEntity: IndexedEntity {}

@available(iOS 16.0, *)
struct NoteQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [NoteEntity] {
        let wanted = Set(identifiers)
        return NoteStore.all().filter { wanted.contains($0.path) }.map(NoteEntity.init)
    }

    func entities(matching string: String) async throws -> [NoteEntity] {
        let q = string.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        return NoteStore.all().filter { $0.title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).contains(q) }.prefix(20).map(NoteEntity.init)
    }

    func suggestedEntities() async throws -> [NoteEntity] {
        NoteStore.all().sorted { $0.modified > $1.modified }.prefix(10).map(NoteEntity.init)
    }
}

/// "Open <note> in Lumen" (Siri, Shortcuts, Spotlight's result).
@available(iOS 16.0, *)
struct OpenNoteIntent: OpenIntent {
    static var title: LocalizedStringResource = "spotlight.open"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "spotlight.note")
    var target: NoteEntity

    init() {}
    init(note: NoteEntity) { target = note }

    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = NoteStore.openURL(target.id) { LumenLaunch.deliver(url) }
        return .result()
    }
}

/// iOS 26: the note's title and snippet as an interactive snippet in Spotlight, with Open.
@available(iOS 26.0, *)
struct NoteSnippetIntent: SnippetIntent {
    static var title: LocalizedStringResource = "spotlight.preview"

    @Parameter(title: "spotlight.note")
    var target: NoteEntity

    @MainActor
    func perform() async throws -> some IntentResult & ShowsSnippetView {
        .result(view: NoteSnippetView(title: target.title, snippet: target.snippet, note: target))
    }
}

@available(iOS 26.0, *)
struct NoteSnippetView: View {
    let title: String
    let snippet: String
    let note: NoteEntity

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline).lineLimit(2)
            Text(snippet).font(.subheadline).foregroundStyle(.secondary).lineLimit(4)
            Button(intent: OpenNoteIntent(note: note)) {
                Label("spotlight.open", systemImage: "arrow.up.forward.app")
            }
        }
        .padding()
    }
}
