// Capture from outside the app (plan W11.P8), like Obsidian 1.14:
//
// - LumenCaptureControl: a Control Center / Lock Screen control (iOS 18+).
// - LumenLockScreenCapture: a Lock Screen widget (circular, rectangular,
//   inline; iOS 16+).
//
// Both open `lumen://capture?native=1&source=…`. The app answers with its
// native capture sheet (App/NativeCapture.swift) at once, without waiting
// for the WebView. The text goes to the App Group queue (Shared/CaptureQueue.swift)
// and from there to inbox.md. Nothing here reads or shows note content.

import AppIntents
import SwiftUI
import WidgetKit

enum CaptureLink {
    static func url(_ source: String) -> URL {
        URL(string: "lumen://capture?native=1&source=\(source)")!
    }
}

/// The control's action: open the app on the native capture sheet.
@available(iOS 18.0, *)
struct OpenCaptureSheetIntent: AppIntent {
    static var title: LocalizedStringResource = "control.capture"
    static var description = IntentDescription("control.capture.description")
    static var openAppWhenRun = true
    static var isDiscoverable = false

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(CaptureLink.url("control")))
    }
}

@available(iOS 18.0, *)
struct LumenCaptureControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.lumen.editor.LumenWidgets.capture") {
            ControlWidgetButton(action: OpenCaptureSheetIntent()) {
                Label("control.capture", systemImage: "tray.and.arrow.down")
            }
        }
        .displayName("control.capture")
        .description("control.capture.description")
    }
}

struct LockCaptureView: View {
    @Environment(\.widgetFamily) var family

    var body: some View {
        let content = Group {
            switch family {
            case .accessoryInline:
                Label("lock.capture", systemImage: "tray.and.arrow.down")
            case .accessoryRectangular:
                HStack(spacing: 6) {
                    Image(systemName: "tray.and.arrow.down").font(.title3)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("lock.capture").font(.headline).lineLimit(1)
                        Text("lock.capture.hint").font(.caption).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            default:
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "tray.and.arrow.down").font(.title2)
                }
            }
        }
        .widgetURL(CaptureLink.url("lockscreen"))
        .accessibilityLabel(Text("lock.capture"))
        if #available(iOS 17.0, *) {
            content.containerBackground(.clear, for: .widget)
        } else {
            content
        }
    }
}

struct LumenLockScreenCapture: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LumenLockScreenCapture", provider: LumenProvider()) { _ in
            LockCaptureView()
        }
        .configurationDisplayName("lock.capture")
        .description("lock.capture.description")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
