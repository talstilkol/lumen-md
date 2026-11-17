/**
 * W13.M1: Android 16 (API 36) — any size, edge to edge, predictive back.
 * The manifest locks nothing and opts in to predictive back; the layout
 * follows the window size class (two columns from 600 dp in the app); back
 * closes the top overlay before it leaves the app.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { androidAdaptiveItems } from "../../scripts/lib/mobileBuild.mjs";
import { isNativeShell, narrowQuery, trackWindowClass, windowClassOf } from "../mobile/windowClass";
import { closeTopOverlay, installBackNavigation, topOverlay } from "../mobile/backNavigation";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const facts = () => ({
  manifest: read("android/app/src/main/AndroidManifest.xml"),
  config: JSON.parse(read("capacitor.config.json")),
  mainActivity: read("android/app/src/main/java/com/lumen/editor/MainActivity.java"),
  css: read("src/index.css"),
});
type Item = { ok: boolean; what: string };
const failing = (items: Item[]) => items.filter((i) => !i.ok).map((i) => i.what);

describe("the manifest and the config (npm run mobile:check)", () => {
  it("the repository passes every Android 16 item", () => {
    const items = androidAdaptiveItems(facts()) as Item[];
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(failing(items)).toEqual([]);
  });

  it("an orientation or aspect lock fails", () => {
    const f = facts();
    expect(failing(androidAdaptiveItems({ ...f, manifest: f.manifest.replace('android:name=".MainActivity"', 'android:name=".MainActivity" android:screenOrientation="portrait"') }))).toEqual([expect.stringMatching(/screenOrientation/)]);
    expect(failing(androidAdaptiveItems({ ...f, manifest: f.manifest.replace('android:resizeableActivity="true"', 'android:resizeableActivity="false"') }))).toEqual([expect.stringMatching(/aspect-ratio lock/)]);
    expect(failing(androidAdaptiveItems({ ...f, manifest: f.manifest.replace("<activity", '<activity android:maxAspectRatio="2.1"') })).length).toBe(1);
  });

  it("predictive back off, or no back callback, fails", () => {
    const f = facts();
    expect(failing(androidAdaptiveItems({ ...f, manifest: f.manifest.replace('android:enableOnBackInvokedCallback="true"', "") }))).toEqual([expect.stringMatching(/predictive back/)]);
    expect(failing(androidAdaptiveItems({ ...f, mainActivity: "public class MainActivity extends BridgeActivity {}" }))).toEqual([expect.stringMatching(/OnBackPressedCallback/)]);
  });

  it("insets go to CSS through SystemBars, with no fixed status-bar colour, and the CSS uses env()", () => {
    const f = facts();
    expect(f.config.plugins.SystemBars.insetsHandling).toBe("css");
    expect(failing(androidAdaptiveItems({ ...f, config: { plugins: {} } })).length).toBe(1);
    expect(failing(androidAdaptiveItems({ ...f, config: { plugins: { ...f.config.plugins, StatusBar: { backgroundColor: "#000" } } } })).length).toBe(1);
    expect(failing(androidAdaptiveItems({ ...f, css: ".bar{height:24px}" })).length).toBe(1);
  });

  it("an empty input is not a pass", () => {
    expect(failing(androidAdaptiveItems({ manifest: "", config: null, mainActivity: "", css: "" })).length).toBeGreaterThanOrEqual(4);
  });
});

describe("window size classes", () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    delete document.documentElement.dataset.windowClass;
  });

  it("compact < 600, medium 600–839, expanded ≥ 840 (phone, unfolded foldable, tablet)", () => {
    expect(windowClassOf(412)).toBe("compact"); // Pixel phone
    expect(windowClassOf(599)).toBe("compact");
    expect(windowClassOf(600)).toBe("medium");
    expect(windowClassOf(673)).toBe("medium"); // Pixel Fold, open
    expect(windowClassOf(840)).toBe("expanded");
    expect(windowClassOf(1280)).toBe("expanded"); // tablet, landscape
  });

  it("the phone layout ends at 600 dp in the app, and stays at 760 px elsewhere", () => {
    expect(narrowQuery(true)).toBe("(max-width: 599.98px)");
    expect(narrowQuery(false)).toBe("(max-width: 760px)");
    expect(isNativeShell({})).toBe(false);
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(narrowQuery()).toBe("(max-width: 599.98px)");
  });

  it("isNarrowScreen asks for the app's query", async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const seen: string[] = [];
    const mm = vi.spyOn(window, "matchMedia").mockImplementation((q: string) => {
      seen.push(q);
      return { matches: false, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList;
    });
    const { isNarrowScreen } = await import("../store/useStore");
    expect(isNarrowScreen()).toBe(false);
    expect(seen).toContain("(max-width: 599.98px)");
    mm.mockRestore();
  });

  it("<html data-window-class> follows resizes, and a hinge shows as two segments", () => {
    const w = { innerWidth: 412, document, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Window & { innerWidth: number; viewport?: unknown };
    const stop = trackWindowClass(w);
    expect(document.documentElement.dataset.windowClass).toBe("compact");
    const onResize = (w.addEventListener as unknown as { mock: { calls: [string, () => void][] } }).mock.calls[0][1];
    (w as { innerWidth: number }).innerWidth = 673;
    (w as { viewport?: unknown }).viewport = { segments: [{}, {}] };
    onResize();
    expect(document.documentElement.dataset.windowClass).toBe("medium");
    expect(document.documentElement.dataset.windowSegments).toBe("2");
    stop();
    expect(w.removeEventListener).toHaveBeenCalled();
  });
});

describe("back closes the top overlay before it leaves the app", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds the top-most open overlay", () => {
    document.body.innerHTML = `<div role="dialog" aria-modal="true" id="a"></div><dialog id="b"></dialog><div data-back-closes id="c" hidden></div>`;
    expect(topOverlay()?.id).toBe("a");
    (document.getElementById("b") as HTMLDialogElement).setAttribute("open", "");
    expect(topOverlay()?.id).toBe("b");
    document.getElementById("c")!.removeAttribute("hidden");
    expect(topOverlay()?.id).toBe("c");
  });

  it("closes it as Escape does, and says when there was none", () => {
    document.body.innerHTML = `<div role="dialog" aria-modal="true" id="sheet"><button id="in">x</button></div>`;
    const sheet = document.getElementById("sheet")!;
    sheet.addEventListener("keydown", (e) => {
      if (e.key === "Escape") sheet.remove();
    });
    (document.getElementById("in") as HTMLButtonElement).focus();
    expect(closeTopOverlay()).toBe(true);
    expect(document.getElementById("sheet")).toBeNull();
    expect(closeTopOverlay()).toBe(false);
  });

  it("reports the state to the native side ahead of the gesture, and handles lumenBack", async () => {
    const calls: boolean[] = [];
    const stop = installBackNavigation({ setBackState: async (o) => void calls.push(o.overlay) });
    expect(calls).toEqual([false]);
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog" aria-modal="true" id="p"></div>`);
    const p = document.getElementById("p")!;
    p.addEventListener("keydown", (e) => e.key === "Escape" && p.remove());
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toEqual([false, true]);
    window.dispatchEvent(new Event("lumenBack"));
    await new Promise((r) => setTimeout(r, 60));
    expect(document.getElementById("p")).toBeNull();
    expect(calls).toEqual([false, true, false]);
    stop();
  });

  it("an older app without setBackState is left alone (no throw, retried later)", async () => {
    const stop = installBackNavigation({ setBackState: () => Promise.reject(new Error("not implemented")) });
    await new Promise((r) => setTimeout(r, 20));
    stop();
  });
});
