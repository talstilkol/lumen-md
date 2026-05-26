//
//  iCloudSync.swift
//  Lumen — iCloud Drive bridge
//
//  Reads / writes from the shared iCloud Drive folder
//  (`~/iCloud Drive/Lumen/`).  The web layer communicates
//  via `window.webkit.messageHandlers.iCloudBridge`.
//

import Foundation
import Capacitor

class ICloudSyncBridge: CAPPlugin {
    private var lastLocalMtime: Date?

    @objc func getDocumentsDirectory(_ call: CAPPluginCall) {
        guard let url = FileManager.default.url(
            forUbiquityContainerIdentifier: nil
        )?.appendingPathComponent("Documents/Lumen") else {
            call.reject("iCloud not available")
            return
        }
        // Ensure directory exists
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        call.resolve(["path": url.path])
    }

    @objc func listFiles(_ call: CAPPluginCall) {
        guard let url = FileManager.default.url(
            forUbiquityContainerIdentifier: nil
        )?.appendingPathComponent("Documents/Lumen") else {
            call.reject("iCloud not available")
            return
        }
        do {
            let files = try FileManager.default.contentsOfDirectory(
                at: url,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: .skipsHiddenFiles
            )
            let result = files.map { fileURL -> [String: Any] in
                let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
                let modified = attrs?[FileAttributeKey.modificationDate] as? Date
                return [
                    "path": fileURL.lastPathComponent,
                    "mtime": modified?.timeIntervalSince1970 ?? 0,
                    "size": (attrs?[FileAttributeKey.size] as? Int64) ?? 0,
                ]
            }
            call.resolve(["files": result])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path")
            return
        }
        guard let url = FileManager.default.url(
            forUbiquityContainerIdentifier: nil
        )?.appendingPathComponent("Documents/Lumen/\(path)") else {
            call.reject("iCloud not available")
            return
        }
        // Start download if file is in iCloud but not local
        do {
            try FileManager.default.startDownloadingUbiquitousItem(at: url)
        } catch { /* already local or error — continue */ }

        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
            do {
                let data = try Data(contentsOf: url)
                let text = String(data: data, encoding: .utf8) ?? ""
                call.resolve(["content": text])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"),
              let content = call.getString("content") else {
            call.reject("Missing path or content")
            return
        }
        guard let url = FileManager.default.url(
            forUbiquityContainerIdentifier: nil
        )?.appendingPathComponent("Documents/Lumen/\(path)") else {
            call.reject("iCloud not available")
            return
        }
        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path")
            return
        }
        guard let url = FileManager.default.url(
            forUbiquityContainerIdentifier: nil
        )?.appendingPathComponent("Documents/Lumen/\(path)") else {
            call.reject("iCloud not available")
            return
        }
        do {
            try FileManager.default.removeItem(at: url)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }
}
