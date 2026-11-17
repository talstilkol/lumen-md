/**
 * The capture Live Activity (plan W13.M2), the WebView's half. While the
 * capture box is open on iPhone, the Lock Screen and the Dynamic Island show
 * "Capture in progress" — or "Recording 03:12" during a voice note — with a
 * Stop button, as Obsidian 1.14 does. It ends by itself when the capture is
 * saved or the box closes.
 *
 * The activity carries no note text: only the mode and when it began (the
 * system draws the running clock). This module is the state machine; the
 * native half is ios/App/App/LiveCapture.swift and the widget extension's
 * CaptureLiveActivity.swift. Outside the iOS app every call is a no-op.
 */

export type ActivityMode = "capture" | "recording";

export interface LiveActivityPlugin {
  startCaptureActivity(o: { mode: ActivityMode; since: number }): Promise<{ id: string | null }>;
  updateCaptureActivity(o: { mode: ActivityMode; since: number }): Promise<void>;
  endCaptureActivity(o: { outcome: "saved" | "cancelled" }): Promise<void>;
  addListener(event: "captureStop", fn: () => void): Promise<{ remove: () => Promise<void> }>;
}

export interface CaptureActivity {
  /** The capture box opened. */
  opened(now?: number): void;
  /** A voice recording started (at `since`), or stopped (back to the open box). */
  recording(on: boolean, now?: number): void;
  /** The capture was saved: the activity ends (it lingers a few seconds, then goes). */
  saved(): void;
  /** The box closed without saving: the activity ends at once. */
  closed(): void;
  /** The Live Activity's Stop button: stop the recording (the box keeps the take). */
  onStop(fn: () => void): () => void;
  /** What is shown now (for tests and diagnostics). */
  state(): { mode: ActivityMode | null; since: number | null };
}

/** "03:12", or "1:03:12" past an hour: the clock the Dynamic Island shows. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/**
 * The state machine. Calls reach the plugin in order and only on a change:
 * opening twice starts one activity, recording on → off → on updates it,
 * saving or closing ends it once.
 */
export function createCaptureActivity(plugin: LiveActivityPlugin | null): CaptureActivity {
  let mode: ActivityMode | null = null;
  let since: number | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const stopFns = new Set<() => void>();
  let sub: Promise<{ remove: () => Promise<void> } | null> | null = null;
  // why: a failed native call (Live Activities off, an older build) must never break capturing
  const call = (f: () => Promise<unknown>) => (chain = chain.then(f).catch(() => undefined));
  const listen = () => {
    if (sub || !plugin) return;
    sub = plugin.addListener("captureStop", () => stopFns.forEach((f) => f())).catch(() => null);
  };
  const unlisten = () => {
    const s = sub;
    sub = null;
    void s?.then((x) => x?.remove());
  };
  const end = (outcome: "saved" | "cancelled") => {
    if (mode === null) return;
    mode = null;
    since = null;
    if (plugin) call(() => plugin.endCaptureActivity({ outcome }));
    unlisten();
  };
  return {
    opened(now = Date.now()) {
      if (mode !== null || !plugin) return;
      mode = "capture";
      since = now;
      listen();
      call(() => plugin.startCaptureActivity({ mode: "capture", since: now }));
    },
    recording(on, now = Date.now()) {
      if (!plugin) return;
      const next: ActivityMode = on ? "recording" : "capture";
      if (mode === null) {
        // The box opened straight into recording (/?capture=voice).
        mode = next;
        since = now;
        listen();
        call(() => plugin.startCaptureActivity({ mode: next, since: now }));
        return;
      }
      if (mode === next) return;
      mode = next;
      since = now;
      call(() => plugin.updateCaptureActivity({ mode: next, since: now }));
    },
    saved: () => end("saved"),
    closed: () => end("cancelled"),
    onStop(fn) {
      stopFns.add(fn);
      return () => void stopFns.delete(fn);
    },
    state: () => ({ mode, since }),
  };
}

let shared: CaptureActivity | null = null;

/** The app's one capture activity: real in the iOS app, a no-op everywhere else. */
export async function captureActivity(): Promise<CaptureActivity> {
  if (shared) return shared;
  const cap = (typeof window === "undefined" ? undefined : (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor);
  const ios = !!cap?.isNativePlatform?.() && cap.getPlatform?.() === "ios";
  const plugin = ios ? (await import("@capacitor/core")).registerPlugin<LiveActivityPlugin>("LumenNative") : null;
  shared = createCaptureActivity(plugin);
  return shared;
}
