// The capture Live Activity's views (plan W13.M2): the Lock Screen banner and
// the Dynamic Island (compact, minimal, expanded). "Capture in progress" or
// "Recording 03:12", a running clock the system draws, and a Stop button
// (iOS 17+). Tapping it opens the capture box (lumen://capture).

import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct CaptureLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CaptureActivityAttributes.self) { context in
            CaptureBanner(state: context.state)
                .padding()
                .activityBackgroundTint(Color.black.opacity(0.6))
                .widgetURL(URL(string: "lumen://capture"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: symbol(context.state)).foregroundStyle(tint(context.state))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(label(context.state)).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    clock(context.state).font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    StopButton()
                }
            } compactLeading: {
                Image(systemName: symbol(context.state)).foregroundStyle(tint(context.state))
            } compactTrailing: {
                clock(context.state).font(.caption2.monospacedDigit()).frame(maxWidth: 44)
            } minimal: {
                Image(systemName: symbol(context.state)).foregroundStyle(tint(context.state))
            }
            .widgetURL(URL(string: "lumen://capture"))
            .keylineTint(tint(context.state))
        }
    }
}

@available(iOS 16.2, *)
private func symbol(_ s: CaptureActivityAttributes.ContentState) -> String {
    s.mode == "recording" ? "waveform" : "square.and.pencil"
}

@available(iOS 16.2, *)
private func tint(_ s: CaptureActivityAttributes.ContentState) -> Color {
    s.mode == "recording" ? .red : .purple
}

@available(iOS 16.2, *)
private func label(_ s: CaptureActivityAttributes.ContentState) -> LocalizedStringKey {
    s.mode == "recording" ? "live.recording" : "live.capturing"
}

/// A clock the system keeps running: no pushes, no battery cost.
@available(iOS 16.2, *)
private func clock(_ s: CaptureActivityAttributes.ContentState) -> Text {
    Text(timerInterval: s.since...Date.distantFuture, countsDown: false)
}

@available(iOS 16.2, *)
private struct CaptureBanner: View {
    let state: CaptureActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol(state)).font(.title2).foregroundStyle(tint(state))
            VStack(alignment: .leading, spacing: 2) {
                Text(label(state)).font(.headline)
                clock(state).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            Spacer()
            StopButton()
        }
        .accessibilityElement(children: .combine)
    }
}

@available(iOS 16.2, *)
private struct StopButton: View {
    var body: some View {
        if #available(iOS 17.0, *) {
            Button(intent: StopCaptureIntent()) {
                Label("live.stop", systemImage: "stop.fill")
            }
            .tint(.red)
        } else {
            Link(destination: URL(string: "lumen://capture")!) {
                Label("live.open", systemImage: "arrow.up.forward.app")
            }
        }
    }
}
