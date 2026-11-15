/**
 * Plans W11.P8, W11.P9: the native capture queue, drained into the inbox.
 *
 * - A kill at any step of the drain loses no capture (W11.P8's acceptance).
 *   Each kill point is replayed, then the app "starts again".
 * - 100 shares (text, links, images, PDFs) reach the inbox with their source:
 *   the link, the file's name and type (W11.P9's acceptance).
 * - The native writer: one atomic file per capture, so a kill while writing
 *   leaves nothing half-written in the list. The Swift is read here, not run;
 *   compiling and running it is the Mac's (W11.M10).
 *
 * The queue items are SYNTHETIC: the shape CaptureQueue.swift writes
 * (`dictionaries()`), made up here.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { JOURNAL_KEY, captureFilePath, captureFileToInbox, drainQueue, fileEntryText, storageJournal, validQueue, type QueuedCapture } from "../mobile/captureQueue";
import { initNativeBridge, type LumenNativePlugin } from "../mobile/nativeActions";
import { readWorkspaceFile, readWorkspaceBlob } from "../storage/workspace";

const read = (p: string) => readFileSync(p, "utf8");

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

class Killed extends Error {}

/** The native queue, as the plugin shows it: a list, a file store, a removal. */
function nativeQueue(items: Record<string, string>[], files: Record<string, Uint8Array> = {}) {
  let queue = [...items];
  return {
    get items() {
      return queue;
    },
    src: (kill: () => void = () => undefined) => ({
      list: async () => queue.map((x) => ({ ...x })),
      read: async (f: string) => files[f] ?? Promise.reject(new Error("no file")),
      remove: async (ids: string[]) => {
        kill();
        queue = queue.filter((x) => !ids.includes(x.id));
      },
    }),
  };
}

const at = (m: number) => new Date(Date.UTC(2026, 10, 15, 8, m)).toISOString();

describe("the queue's items", () => {
  it("text, link and file captures with their source; before-W11.P8 items are Siri text", () => {
    const q = validQueue([
      { id: "old", text: "מסירי", at: at(0) },
      { id: "t", kind: "text", text: "שורה", at: at(1), source: "control" },
      { id: "u", kind: "url", text: "A page", url: "https://example.org/a", at: at(2), source: "share" },
      { id: "i", kind: "image", text: "", file: "1F2E.jpg", mime: "image/jpeg", name: "IMG_1.jpg", at: at(3), source: "share" },
      { id: "p", kind: "pdf", text: "", file: "9A.pdf", mime: "application/pdf", name: "חשבונית.pdf", at: at(4), source: "share" },
    ]);
    expect(q.map((c) => [c.id, c.kind, c.source])).toEqual([
      ["old", "text", "siri"],
      ["t", "text", "control"],
      ["u", "url", "share"],
      ["i", "image", "share"],
      ["p", "pdf", "share"],
    ]);
    expect(q[4].name).toBe("חשבונית.pdf");
  });

  it("refuses a file name with a path, a link that is not http(s), an unknown kind or source", () => {
    const bad = [
      { id: "1", kind: "pdf", file: "../../Library/x.pdf", at: at(0), source: "share" },
      { id: "2", kind: "image", file: "a/b.jpg", at: at(0), source: "share" },
      { id: "3", kind: "image", file: ".hidden", at: at(0), source: "share" },
      { id: "4", kind: "url", url: "javascript:alert(1)", at: at(0), source: "share" },
      { id: "5", kind: "url", url: "file:///etc/passwd", at: at(0), source: "share" },
      { id: "6", kind: "video", text: "x", at: at(0), source: "share" },
      { id: "7", kind: "text", text: "x", at: at(0), source: "elsewhere" },
      { id: "8", kind: "text", text: "  ", at: at(0), source: "share" },
    ];
    expect(validQueue(bad)).toEqual([]);
  });
});

describe("a kill at any step loses no capture (W11.P8)", () => {
  const items: Record<string, string>[] = [
    { id: "a", kind: "text", text: "ראשון", at: at(1), source: "lockscreen" },
    { id: "b", kind: "url", text: "דף", url: "https://example.org/b", at: at(2), source: "share" },
    { id: "c", kind: "text", text: "שלישי", at: at(3), source: "siri" },
  ];
  // The steps of one drain: per capture, the inbox write and the journal write; then the removal.
  const STEPS = ["write a", "journal a", "write b", "journal b", "write c", "journal c", "remove"];

  for (const [k, step] of STEPS.entries()) {
    it(`killed at "${step}", then started again: every capture is in the inbox, the queue is empty`, async () => {
      const storage = memStorage();
      const q = nativeQueue(items);
      const inbox: string[] = [];
      // Every step with an effect calls tick() first. At step k the process dies: that step and all after it never happen.
      let n = 0;
      let dead = false;
      const tick = () => {
        if (dead || n++ === k) {
          dead = true;
          throw new Killed(STEPS[k]);
        }
      };
      const journal = storageJournal(storage);
      const killingJournal = { has: journal.has, add: (id: string) => (tick(), journal.add(id)), keepOnly: (ids: Set<string>) => (tick(), journal.keepOnly(ids)) };
      // The first run dies at step k (the kill reaches past drainQueue's catch: the process is gone).
      await expect(
        drainQueue(q.src(tick), {
          text: async (text) => {
            tick();
            inbox.push(text);
          },
        }, killingJournal),
      ).rejects.toBeInstanceOf(Killed);
      // The next start, with the same localStorage and the same native queue.
      await drainQueue(q.src(), { text: async (text) => void inbox.push(text) }, storageJournal(storage));
      expect(q.items).toEqual([]);
      for (const want of ["ראשון", "דף <https://example.org/b>", "שלישי"]) expect(inbox, step).toContain(want);
      // A repeat is possible only when the kill came between the inbox write and its journal entry.
      const repeats = inbox.length - 3;
      expect(repeats, step).toBe(step.startsWith("journal") ? 1 : 0);
      expect(JSON.parse(storage.getItem(JOURNAL_KEY) ?? "[]")).toEqual([]);
    });
  }

  it("an inbox write that fails keeps that capture and the later ones, in order", async () => {
    const q = nativeQueue(items);
    let first = true;
    const out: string[] = [];
    const removed = await drainQueue(q.src(), {
      text: async (t) => {
        if (t === "שלישי" && first) {
          first = false;
          throw new Error("vault closed");
        }
        out.push(t);
      },
    }, storageJournal(memStorage()));
    expect(removed).toEqual(["a", "b"]);
    expect(q.items.map((x) => x.id)).toEqual(["c"]);
  });

  it("a failed removal is retried without adding the capture again", async () => {
    const storage = memStorage();
    const q = nativeQueue(items.slice(0, 1));
    const inbox: string[] = [];
    const src = q.src();
    await expect(drainQueue({ ...src, remove: async () => Promise.reject(new Error("plugin gone")) }, { text: async (t) => void inbox.push(t) }, storageJournal(storage))).rejects.toThrow("plugin gone");
    await drainQueue(q.src(), { text: async (t) => void inbox.push(t) }, storageJournal(storage));
    expect(inbox).toEqual(["ראשון"]);
    expect(q.items).toEqual([]);
  });
});

describe("100 shares reach the inbox with their source (W11.P9)", () => {
  it("text, links, images and PDFs: 100 of 100, each with its link or file name", async () => {
    const items: Record<string, string>[] = [];
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 100; i++) {
      const id = `ID${String(i).padStart(3, "0")}-ABCDEF`;
      const base = { id, at: new Date(Date.UTC(2026, 10, 15, 8, 0, i)).toISOString(), source: "share" };
      if (i % 4 === 0) items.push({ ...base, kind: "text", text: `טקסט משותף ${i}` });
      else if (i % 4 === 1) items.push({ ...base, kind: "url", text: `כותרת ${i}`, url: `https://example.org/p/${i}` });
      else if (i % 4 === 2) {
        items.push({ ...base, kind: "image", text: "", file: `${id}.jpg`, mime: "image/jpeg", name: `IMG_${i}.jpg` });
        files[`${id}.jpg`] = Uint8Array.of(0xff, 0xd8, i);
      } else {
        items.push({ ...base, kind: "pdf", text: `מסמך ${i}`, file: `${id}.pdf`, mime: "application/pdf", name: `doc ${i}.pdf` });
        files[`${id}.pdf`] = new TextEncoder().encode(`%PDF-1.7 ${i}`);
      }
    }
    const q = nativeQueue(items, files);
    const got: { c: QueuedCapture; text?: string; bytes?: Uint8Array }[] = [];
    const removed = await drainQueue(
      q.src(),
      { text: async (text, _w, c) => void got.push({ c, text }), file: async (c, bytes) => void got.push({ c, bytes }) },
      storageJournal(memStorage()),
    );
    expect(removed).toHaveLength(100);
    expect(q.items).toEqual([]);
    expect(got).toHaveLength(100);
    for (const [i, g] of got.entries()) {
      expect(g.c.source).toBe("share");
      if (i % 4 === 1) expect(g.text).toBe(`כותרת ${i} <https://example.org/p/${i}>`);
      if (i % 4 === 2) expect([g.c.kind, g.c.name, [...g.bytes!]]).toEqual(["image", `IMG_${i}.jpg`, [0xff, 0xd8, i]]);
      if (i % 4 === 3) expect([g.c.kind, g.c.name, new TextDecoder().decode(g.bytes!)]).toEqual(["pdf", `doc ${i}.pdf`, `%PDF-1.7 ${i}`]);
    }
  });

  it("without a file handler, images and PDFs wait in the queue (and what is after them)", async () => {
    const q = nativeQueue([
      { id: "t1", kind: "text", text: "a", at: at(1), source: "share" },
      { id: "f", kind: "pdf", text: "", file: "F.pdf", at: at(2), source: "share" },
      { id: "t2", kind: "text", text: "b", at: at(3), source: "share" },
    ]);
    expect(await drainQueue(q.src(), { text: async () => undefined }, storageJournal(memStorage()))).toEqual(["t1"]);
    expect(q.items.map((x) => x.id)).toEqual(["f", "t2"]);
  });

  it("a file is saved under attachments/ and linked from the inbox, with the capture's time", async () => {
    installFakeOpfs();
    localStorage.clear();
    const c = validQueue([{ id: "AB12CD34-0000", kind: "pdf", text: "החשבונית", file: "AB12CD34-0000.pdf", name: "חשבונית מרץ.pdf", mime: "application/pdf", at: at(5), source: "share" }])[0];
    const when = new Date(2026, 10, 15, 9, 5);
    const path = captureFilePath(c, when);
    expect(path).toBe("attachments/capture-2026-11-15-0905-חשבונית-מרץ-ab12cd34.pdf");
    await captureFileToInbox(c, new TextEncoder().encode("%PDF-1.7"), when);
    expect(new TextDecoder().decode(new Uint8Array(await (await readWorkspaceBlob(path))!.arrayBuffer()))).toBe("%PDF-1.7");
    const inbox = await readWorkspaceFile("inbox.md");
    expect(inbox).toContain("09:05 החשבונית");
    expect(inbox).toContain(`  [חשבונית מרץ.pdf](<${path}>)`);
    expect(fileEntryText({ ...c, kind: "image", name: "a.jpg" }, "attachments/x.jpg")).toBe("החשבונית\n![a.jpg](<attachments/x.jpg>)");
  });
});

describe("the bridge drains the queue through the plugin", () => {
  beforeEach(() => localStorage.clear());

  it("text through captureText, a shared PDF through captureFile (base64), then only those removed", async () => {
    const removed: string[][] = [];
    const plugin: LumenNativePlugin = {
      getLaunchUrl: async () => ({ url: null }),
      pendingCaptures: async () => ({
        items: [
          { id: "x", kind: "text", text: "מהנעילה", at: at(1), source: "lockscreen" },
          { id: "y", kind: "pdf", text: "", file: "Y.pdf", name: "a.pdf", mime: "application/pdf", at: at(2), source: "share" },
        ],
      }),
      removeCaptures: async ({ ids }) => void removed.push(ids),
      captureFile: async ({ file }) => ({ data: btoa(`bytes of ${file}`) }),
      addListener: async () => ({ remove: async () => undefined }),
    };
    const calls: string[] = [];
    await initNativeBridge(
      {
        capture: () => undefined,
        captureText: async (t) => void calls.push(`text ${t}`),
        captureFile: async (c, bytes) => void calls.push(`file ${c.name} ${new TextDecoder().decode(bytes)}`),
        newNote: () => undefined,
        search: () => undefined,
        daily: () => undefined,
      },
      plugin,
    );
    expect(calls).toEqual(["text מהנעילה", "file a.pdf bytes of Y.pdf"]);
    expect(removed).toEqual([["x", "y"]]);
  });
});

describe("the native writer (Swift, read here; compiled on the Mac)", () => {
  const swift = read("ios/App/Shared/CaptureQueue.swift");

  it("one file per capture, written atomically; the list reads only finished .json files", () => {
    expect(swift).toMatch(/data\.write\(to: dir\.appendingPathComponent\(fileName\(c\)\), options: \[\.atomic/);
    expect(swift).toMatch(/names\.filter \{ \$0\.hasSuffix\("\.json"\) \}\.sorted\(\)/);
    // No read-modify-write of a shared list (two writers at once would drop one).
    expect(swift).not.toMatch(/UserDefaults\([^)]*\)\??\.set\(/);
    // A file is copied before its JSON (the commit point), and the copy removed if the commit fails.
    expect(swift.indexOf("try data.write(to: dest")).toBeLessThan(swift.indexOf("return try add(QueuedCapture(kind: kind"));
    expect(swift).toContain("try? FileManager.default.removeItem(at: dest)");
    // Written by the App Group container, readable after the first unlock (the Lock Screen).
    expect(swift).toContain('static let group = "group.com.lumen.editor"');
    expect(swift).toContain(".completeFileProtectionUntilFirstUserAuthentication");
  });

  it("the JSON keys the Swift writes are the ones the drain reads", () => {
    const keys = [...swift.matchAll(/d\["(\w+)"\] = v|"(\w+)": c\.\w+/g)].map((m) => m[1] ?? m[2]).sort();
    expect(keys).toEqual(["at", "file", "id", "kind", "mime", "name", "source", "text", "url"]);
    const sources = [...read("ios/App/App/NativeCapture.swift").matchAll(/\["control", "lockscreen", "shortcut", "widget"\]/g)];
    expect(sources).toHaveLength(1);
    for (const s of ["siri", "share", "legacy", "control", "lockscreen", "shortcut"]) expect(validQueue([{ id: "1", text: "x", at: at(0), source: s }]), s).toHaveLength(1);
  });

  it("the old UserDefaults queue is moved over once and its key removed", () => {
    expect(swift).toMatch(/static func migrateLegacy[\s\S]*?"lumen\.pendingCaptures"[\s\S]*?d\.removeObject\(forKey: key\)/);
    expect(read("ios/App/App/LumenNative.swift")).toMatch(/static func all\(\)[\s\S]*?CaptureQueue\.migrateLegacy\(\)/);
  });
});
