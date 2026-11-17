// The document camera (plan W13.M4): VisionKit's VNDocumentCameraViewController
// finds the page, flattens and cleans it, on the device. The pages go back to
// the WebView as JPEG, with a PDF of them; the WebView keeps the PDF in
// attachments/ and reads the text with its own OCR (src/mobile/docScanner.ts).

import Capacitor
import UIKit
import VisionKit

final class DocScanner: NSObject, VNDocumentCameraViewControllerDelegate {
    private var call: CAPPluginCall?
    private var maxPages = 24
    private static var current: DocScanner?

    static func start(_ call: CAPPluginCall, from vc: UIViewController?) {
        guard VNDocumentCameraViewController.isSupported, let vc = vc else {
            call.resolve(["status": "unavailable"])
            return
        }
        let s = DocScanner()
        s.call = call
        s.maxPages = max(1, min(call.getInt("maxPages") ?? 24, 50))
        current = s
        let camera = VNDocumentCameraViewController()
        camera.delegate = s
        vc.present(camera, animated: true)
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let count = min(scan.pageCount, maxPages)
        let images = (0..<count).map { scan.imageOfPage(at: $0) }
        controller.dismiss(animated: true)
        DispatchQueue.global(qos: .userInitiated).async {
            let pages = images.compactMap { $0.jpegData(compressionQuality: 0.8)?.base64EncodedString() }
            let pdf = DocScanner.pdf(images)?.base64EncodedString()
            self.finish(["status": "ok", "engine": "visionkit", "pages": pages, "pdf": pdf as Any])
        }
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        finish(["status": "cancelled"])
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        finish(["status": "unavailable"])
    }

    private func finish(_ result: [String: Any]) {
        call?.resolve(result)
        call = nil
        DocScanner.current = nil
    }

    /// One PDF page per scanned page, at the page's own size.
    static func pdf(_ images: [UIImage]) -> Data? {
        guard let first = images.first else { return nil }
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: first.size))
        return renderer.pdfData { ctx in
            for img in images {
                ctx.beginPage(withBounds: CGRect(origin: .zero, size: img.size), pageInfo: [:])
                img.draw(in: CGRect(origin: .zero, size: img.size))
            }
        }
    }
}
