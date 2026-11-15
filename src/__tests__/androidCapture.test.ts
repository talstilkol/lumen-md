/**
 * Plan W11.P10 (and the Android half of W11.P8, W10.C31): "Share → Lumen"
 * through ACTION_SEND / ACTION_SEND_MULTIPLE, and the Quick Settings tile with
 * its native capture box, all into the capture queue the WebView drains.
 *
 * - The manifest and resources are read here: what a Gradle lint would
 *   reject first (exported components, the tile's permission, Hebrew for
 *   every new string, start/end layouts). The compile is the Mac's (W10.M4);
 *   offline, tools/native-check/check-android.sh compiles the Java against
 *   stubs and test-android.sh runs CaptureQueueTest with JUnit.
 * - Text, a link and an image from the Android queue reach the inbox with
 *   their source and app; a shared WhatsApp message goes through
 *   chatShareText (the W5.7 gap). The queue items are SYNTHETIC, in the
 *   shape CaptureQueue.java writes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { drainQueue, storageJournal, validQueue, type QueuedCapture } from "../mobile/captureQueue";

const read = (p: string) => readFileSync(p, "utf8");
const MAIN = "android/app/src/main";
const manifest = read(`${MAIN}/AndroidManifest.xml`);

/** One component's XML in the manifest, by its android:name: the opening tag, and its body when it has one. */
function component(tag: string, name: string): string {
  for (const m of manifest.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))) {
    if (!m[0].includes(`android:name="${name}"`)) continue;
    if (m[0].endsWith("/>")) return m[0];
    const end = manifest.indexOf(`</${tag}>`, m.index!);
    return manifest.slice(m.index!, end + tag.length + 3);
  }
  throw new Error(`${tag} ${name} not in the manifest`);
}

describe("the manifest (W11.P10, W10.C31)", () => {
  it("Share → Lumen: SEND for text, SEND and SEND_MULTIPLE for images and PDFs, exported, no WebView", () => {
    const share = component("activity", ".ShareActivity");
    expect(share).toContain('android:exported="true"');
    expect(share).toContain('android:theme="@android:style/Theme.Translucent.NoTitleBar"');
    const filters = [...share.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]);
    const of = (f: string) => ({
      actions: [...f.matchAll(/<action android:name="([^"]+)"/g)].map((m) => m[1]).sort(),
      mimes: [...f.matchAll(/android:mimeType="([^"]+)"/g)].map((m) => m[1]).sort(),
      defaultCategory: f.includes('android:name="android.intent.category.DEFAULT"'),
    });
    expect(filters.map(of)).toEqual([
      { actions: ["android.intent.action.SEND"], mimes: ["text/plain"], defaultCategory: true },
      { actions: ["android.intent.action.SEND", "android.intent.action.SEND_MULTIPLE"], mimes: ["application/pdf", "image/*"], defaultCategory: true },
    ]);
  });

  it("the tile: a TileService bound only by the system, with an icon and a label; the box it opens is not exported", () => {
    const tile = component("service", ".CaptureTileService");
    expect(tile).toContain('android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"');
    expect(tile).toContain('<action android:name="android.service.quicksettings.action.QS_TILE" />');
    expect(tile).toContain('android:icon="@drawable/ic_tile_capture"');
    expect(tile).toContain('android:label="@string/tile_capture"');
    expect(tile).toContain('android:exported="true"');
    expect(component("activity", ".CaptureActivity")).toContain('android:exported="false"');
  });

  it("every activity, service and receiver says whether it is exported (required from Android 12)", () => {
    const tags = [...manifest.matchAll(/<(activity|service|receiver|provider)\b[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThanOrEqual(6);
    for (const t of tags) expect(t, t).toMatch(/android:exported="(true|false)"/);
  });

  it("the new strings have Hebrew, and the capture box lays out with start/end only", () => {
    const names = (x: string) => new Set([...x.matchAll(/<string name="([a-z_]+)"/g)].map((m) => m[1]));
    const en = names(read(`${MAIN}/res/values/strings.xml`));
    const he = names(read(`${MAIN}/res/values-iw/strings.xml`));
    const fresh = ["share_saved", "share_failed", "share_nothing", "capture_hint", "capture_save", "capture_cancel", "capture_saved", "capture_failed", "tile_capture"];
    for (const k of fresh) {
      expect(en.has(k), k).toBe(true);
      expect(he.has(k), k).toBe(true);
    }
    const layout = read(`${MAIN}/res/layout/activity_capture.xml`);
    expect(layout).not.toMatch(/Left|Right|"(left|right)"|\|left|\|right/);
    expect(layout).toContain('android:layoutDirection="locale"');
    for (const id of ["capture_text", "capture_save", "capture_cancel"]) expect(layout).toContain(`android:id="@+id/${id}"`);
  });

  it("the Java: the share sheet and the tile write to the queue, the plugin hands it over", () => {
    const java = (n: string) => read(`${MAIN}/java/com/lumen/editor/${n}.java`);
    const share = java("ShareActivity");
    expect(share).toContain('q.addText(t, "share", app)');
    expect(share).toContain('"share", app);');
    expect(share).toContain("getReferrer()");
    // Only content:// streams are read (a file:// path from another app is refused).
    expect(share).toContain('if (!"content".equals(uri.getScheme())) return false;');
    expect(java("CaptureTileService")).toMatch(/new Intent\(this, CaptureActivity\.class\)/);
    expect(java("CaptureActivity")).toContain("Captures.queue(this).addText(");
    const plugin = java("LumenNativePlugin");
    for (const m of ["pendingCaptures", "removeCaptures", "captureFile"]) expect(plugin).toMatch(new RegExp(`@PluginMethod\\s+public void ${m}\\(`));
    expect(plugin).toContain("Captures.queue(getContext()).list()");
    // The JSON keys Java writes are ones the drain reads.
    const keys = new Set([...java("CaptureQueue").matchAll(/c\.put\("(\w+)"/g)].map((m) => m[1]));
    expect([...keys].sort()).toEqual(["app", "at", "file", "id", "kind", "mime", "name", "source", "text", "url"]);
    // A temporary name, flushed, then renamed: never a half-written .json.
    expect(java("CaptureQueue")).toMatch(/out\.getFD\(\)\.sync\(\);[\s\S]*?tmp\.renameTo\(dest\)/);
  });
});

describe("from Android's queue to the inbox (W11.P10)", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  // As CaptureQueue.java writes them (toJson of a flat map of strings).
  const items = [
    { id: "A1", kind: "text", text: "[14:03, 12.11.2026] טל: נפגשים מחר ב-9", at: "2026-11-15T08:00:00.000Z", source: "share", app: "com.whatsapp" },
    { id: "B2", kind: "url", text: "מאמר", url: "https://example.org/article", at: "2026-11-15T08:01:00.000Z", source: "share", app: "com.android.chrome" },
    { id: "C3", kind: "image", text: "", file: "C3.jpg", mime: "image/jpeg", name: "IMG_20261115.jpg", at: "2026-11-15T08:02:00.000Z", source: "share", app: "com.google.android.apps.photos" },
    { id: "D4", kind: "text", text: "שורה מהאריח", at: "2026-11-15T08:03:00.000Z", source: "tile" },
    { id: "E5", kind: "text", text: "x", at: "2026-11-15T08:04:00.000Z", source: "share", app: "../../bad" },
  ];

  it("text, a link and an image arrive with their source and app; a WhatsApp message through chatShareText", async () => {
    const q = validQueue(items);
    expect(q.map((c) => [c.id, c.source, c.app ?? null])).toEqual([
      ["A1", "share", "com.whatsapp"],
      ["B2", "share", "com.android.chrome"],
      ["C3", "share", "com.google.android.apps.photos"],
      ["D4", "tile", null],
      ["E5", "share", null], // a malformed package name is dropped, the capture kept
    ]);
    let queue = [...items];
    const got: string[] = [];
    const files: QueuedCapture[] = [];
    await drainQueue(
      {
        list: async () => queue,
        read: async (f) => new TextEncoder().encode(f),
        remove: async (ids) => void (queue = queue.filter((x) => !ids.includes(x.id))),
      },
      { text: async (t, _w, c) => void got.push(`${c.source}: ${t}`), file: async (c) => void files.push(c) },
      storageJournal(mem()),
    );
    expect(got).toEqual(["share: WhatsApp · טל · 2026-11-12 14:03\nנפגשים מחר ב-9", "share: מאמר <https://example.org/article>", "tile: שורה מהאריח", "share: x"]);
    expect(files.map((c) => [c.name, c.app])).toEqual([["IMG_20261115.jpg", "com.google.android.apps.photos"]]);
    expect(queue).toEqual([]);
  });

  it("a line typed in the tile's box is not read as a chat message (only shares are)", async () => {
    const line = "[14:03, 12.11.2026] טל: זה פתק שלי";
    const got: string[] = [];
    await drainQueue(
      { list: async () => [{ id: "T", kind: "text", text: line, at: "2026-11-15T08:00:00.000Z", source: "tile" }], remove: async () => undefined },
      { text: async (t) => void got.push(t) },
      storageJournal(mem()),
    );
    expect(got).toEqual([line]);
  });
});
