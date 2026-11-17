// Quick Look preview of Lumen's files (plan W13.K2): a data-based preview
// (macOS 12+). The HTML comes from the Rust renderer (src-tauri/preview),
// linked as a static library: no WebView of our own, no script, no network.
//
// NOT BUILT IN THE CLOUD: built on the Mac by scripts/macos/quicklook.mjs
// (swiftc + the static library) and placed in Lumen.app/Contents/PlugIns by
// tauri's bundle.macOS.files. The owner's Mac run checks it (space bar on a
// Hebrew note in Finder).
import Foundation
import QuickLookUI
import UniformTypeIdentifiers

@_silgen_name("lumen_preview_render")
func lumen_preview_render(_ kind: UInt8, _ name: UnsafePointer<UInt8>?, _ nameLen: Int, _ ptr: UnsafePointer<UInt8>?, _ len: Int, _ outLen: UnsafeMutablePointer<Int>) -> UnsafeMutablePointer<UInt8>?

@_silgen_name("lumen_preview_free")
func lumen_preview_free(_ p: UnsafeMutablePointer<UInt8>?, _ len: Int)

enum PreviewError: Error { case unreadable, unsupported }

/// The file kind the renderer takes: 0 Markdown, 1 Excalidraw, 2 Base.
func kindOf(_ url: URL) -> UInt8? {
    switch url.pathExtension.lowercased() {
    case "md", "markdown": return 0
    case "excalidraw": return 1
    case "base": return 2
    default: return nil
    }
}

func render(_ url: URL) throws -> (Data, UTType) {
    guard let kind = kindOf(url) else { throw PreviewError.unsupported }
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    let name = Array(url.lastPathComponent.utf8)
    var outLen = 0
    let out: UnsafeMutablePointer<UInt8>? = data.withUnsafeBytes { raw in
        name.withUnsafeBufferPointer { n in
            lumen_preview_render(kind, n.baseAddress, n.count, raw.bindMemory(to: UInt8.self).baseAddress, raw.count, &outLen)
        }
    }
    guard let p = out else { throw PreviewError.unreadable }
    defer { lumen_preview_free(p, outLen) }
    return (Data(bytes: p, count: outLen), kind == 1 ? .svg : .html)
}

final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let (data, type) = try render(request.fileURL)
        return QLPreviewReply(dataOfContentType: type, contentSize: CGSize(width: 900, height: 1100)) { reply in
            reply.stringEncoding = .utf8
            return data
        }
    }
}
