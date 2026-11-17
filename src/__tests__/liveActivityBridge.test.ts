/**
 * W13.M2: the capture Live Activity. "Capture in progress" while the box is
 * open, "Recording 03:12" during a voice note, a Stop button, and an end on
 * save or close — each native call once, in order, carrying no note text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCaptureActivity, formatElapsed, type LiveActivityPlugin } from "../mobile/liveActivity";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function fakePlugin() {
  const calls: Array<[string, unknown]> = [];
  let stop: (() => void) | null = null;
  let removed = 0;
  const p: LiveActivityPlugin = {
    startCaptureActivity: async (o) => (calls.push(["start", o]), { id: "a1" }),
    updateCaptureActivity: async (o) => void calls.push(["update", o]),
    endCaptureActivity: async (o) => void calls.push(["end", o]),
    addListener: async (_e, fn) => {
      stop = fn;
      return { remove: async () => void removed++ };
    },
  };
  return { p, calls, press: () => stop?.(), removed: () => removed };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the state machine", () => {
  it("open → record → stop recording → save: start, update, update, end(saved)", async () => {
    const f = fakePlugin();
    const a = createCaptureActivity(f.p);
    a.opened(1000);
    a.opened(1500); // a second open does not start a second activity
    a.recording(true, 2000);
    a.recording(true, 2100);
    a.recording(false, 5000);
    a.saved();
    a.closed(); // after a save, closing changes nothing
    await flush();
    expect(f.calls).toEqual([
      ["start", { mode: "capture", since: 1000 }],
      ["update", { mode: "recording", since: 2000 }],
      ["update", { mode: "capture", since: 5000 }],
      ["end", { outcome: "saved" }],
    ]);
    expect(a.state()).toEqual({ mode: null, since: null });
    expect(f.removed()).toBe(1);
  });

  it("a box opened straight into recording starts as recording; closing without saving ends it at once", async () => {
    const f = fakePlugin();
    const a = createCaptureActivity(f.p);
    a.recording(true, 42);
    a.closed();
    await flush();
    expect(f.calls).toEqual([
      ["start", { mode: "recording", since: 42 }],
      ["end", { outcome: "cancelled" }],
    ]);
  });

  it("the Stop button reaches the box while the activity runs", async () => {
    const f = fakePlugin();
    const a = createCaptureActivity(f.p);
    let stopped = 0;
    const off = a.onStop(() => stopped++);
    a.opened();
    await flush();
    f.press();
    expect(stopped).toBe(1);
    off();
    f.press();
    expect(stopped).toBe(1);
  });

  it("no note text ever crosses to the native side", async () => {
    const f = fakePlugin();
    const a = createCaptureActivity(f.p);
    a.opened(1);
    a.recording(true, 2);
    a.saved();
    await flush();
    expect(JSON.stringify(f.calls)).not.toMatch(/text|content|title/);
  });

  it("a failing native side never breaks capturing; and outside iOS everything is a no-op", async () => {
    const broken: LiveActivityPlugin = {
      startCaptureActivity: () => Promise.reject(new Error("Live Activities are off")),
      updateCaptureActivity: () => Promise.reject(new Error("x")),
      endCaptureActivity: () => Promise.reject(new Error("x")),
      addListener: () => Promise.reject(new Error("x")),
    };
    const a = createCaptureActivity(broken);
    expect(() => {
      a.opened();
      a.recording(true);
      a.saved();
    }).not.toThrow();
    await flush();
    const none = createCaptureActivity(null);
    none.opened();
    none.recording(true);
    expect(none.state().mode).toBeNull();
  });
});

describe("the clock", () => {
  it("mm:ss, then h:mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(192_000)).toBe("03:12");
    expect(formatElapsed(3_792_000)).toBe("1:03:12");
    expect(formatElapsed(-5)).toBe("00:00");
  });
});

describe("the native half", () => {
  it("the app declares Live Activities and the widget extension draws the activity", () => {
    expect(read("ios/App/App/Info.plist")).toMatch(/<key>NSSupportsLiveActivities<\/key>\s*<true\/>/);
    const views = read("ios/App/LumenWidgets/CaptureLiveActivity.swift");
    for (const part of ["ActivityConfiguration(for: CaptureActivityAttributes.self)", "compactLeading", "compactTrailing", "minimal:", "Button(intent: StopCaptureIntent())", "Text(timerInterval:"]) expect(views, part).toContain(part);
    expect(read("ios/App/LumenWidgets/LumenWidgets.swift")).toContain("CaptureLiveActivity()");
  });

  it("the attributes carry only the mode and the start time", () => {
    const attrs = read("ios/App/Shared/CaptureActivity.swift");
    const state = /struct ContentState: Codable, Hashable \{([\s\S]*?)\n    \}/.exec(attrs)![1];
    expect([...state.matchAll(/var (\w+):/g)].map((m) => m[1])).toEqual(["mode", "since"]);
  });

  it("both targets compile the shared attributes; the app the controller; the widget the views", () => {
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    const phase = (id: string) => new RegExp(`${id} /\\* Sources \\*/ = \\{[\\s\\S]*?\\};`).exec(pbx)![0];
    const app = phase("504EC3001FED79650016851F");
    const widgets = phase("C7A00000000000000000001C");
    expect(app).toMatch(/CaptureActivity\.swift in Sources/);
    expect(app).toMatch(/LiveCapture\.swift in Sources/);
    expect(widgets).toMatch(/CaptureActivity\.swift in Sources/);
    expect(widgets).toMatch(/CaptureLiveActivity\.swift in Sources/);
  });

  it("Hebrew and English strings for the activity", () => {
    for (const l of ["en", "he"]) {
      const s = read(`ios/App/LumenWidgets/${l}.lproj/Localizable.strings`);
      for (const k of ["live.capturing", "live.recording", "live.stop"]) expect(s, `${l} ${k}`).toContain(`"${k}"`);
    }
    expect(read("ios/App/LumenWidgets/he.lproj/Localizable.strings")).toContain('"live.capturing" = "לכידה פעילה";');
  });
});
