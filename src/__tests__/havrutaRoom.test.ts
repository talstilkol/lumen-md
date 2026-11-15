// @vitest-environment node
/**
 * Plan W12.H1 — havruta: a shared study room on a Sefaria reference,
 * end-to-end encrypted through the relay.
 *
 *  - No payload in the room carries the source text: not the plaintext
 *    document, not what goes on the wire (checked byte for byte on every
 *    message a real relay sends and receives), not presence.
 *  - Two clients sync a note on a segment in < 1 s through a local relay:
 *    the real Node live-share server (sync-server/collab-server.mjs, e2ee
 *    only) and the real HocuspocusProvider.
 *  - Airplane mode: 0 requests to Sefaria; the text comes from the vault's
 *    offline copy.
 *
 * The passage is a SYNTHETIC Sefaria response in the documented
 * /api/v3/texts form: Genesis 1:1–3 in Hebrew (the public-domain Masoretic
 * text) and a made-up copyrighted translation, to exercise the licence rules.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { roomSocketUrl } from "../collab/persistentProvider";
import { committedRoomName } from "../collab/roomProof";
import { requestRoomToken } from "../collab/roomToken";
import { parseTextsResponse } from "../sources/sefaria/client";
import { parseSourceRef } from "../sources/sefaria/refs";
import { savePassage, type SourceStorage } from "../sources/sefaria/store";
import { addHighlight, addNote, listNotes, newHavrutaRoomName, notesBySegment, roomRef, sourceOverlap, SourceTextInNoteError, HAVRUTA_ROOM_PREFIX } from "../havruta/room";
import { loadStudyText, localSegments, segmentCount, type StudyText } from "../havruta/text";
import { openHavruta, type HavrutaConnect, type HavrutaSession } from "../havruta/session";
import { havrutaInviteLink, havrutaInviteQr, readHavrutaInvite } from "../havruta/invite";
// @ts-expect-error -- plain ESM server module, no types
import { createCollabServer } from "../../sync-server/collab-server.mjs";

const HE = ["בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃", "וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל־פְּנֵי תְהוֹם וְרוּחַ אֱלֹהִים מְרַחֶפֶת עַל־פְּנֵי הַמָּיִם׃", "וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי־אוֹר׃"];
const RESPONSE = {
  ref: "Genesis 1:1-3",
  heRef: "בראשית א׳:א׳-ג׳",
  versions: [
    { text: HE, language: "he", actualLanguage: "he", direction: "rtl", versionTitle: "Miqra according to the Masorah", versionSource: "https://example.org/miqra", license: "CC-BY-SA", isSource: true },
    { text: ["When God began to create", "the earth being unformed and void", "God said let there be light"], language: "en", actualLanguage: "en", direction: "ltr", versionTitle: "Example copyrighted translation", versionSource: "https://example.org/t", license: "Copyright: Example Publisher", isSource: false },
  ],
};
const REF = parseSourceRef("Genesis 1:1-3") ?? parseSourceRef("Genesis 1:1")!;
const PASSAGE = parseTextsResponse(REF, RESPONSE);

const memStorage = (): SourceStorage & { files: Map<string, string> } => {
  const files = new Map<string, string>();
  return { files, read: async (p) => files.get(p) ?? null, write: async (p, c) => void files.set(p, c) };
};
const noFetch = (calls: string[]): typeof fetch => (async (u: RequestInfo | URL) => {
  calls.push(String(u));
  throw new Error("network used");
}) as typeof fetch;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
async function until(fn: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}

describe("the room holds pointers and notes, never the text", () => {
  it("text loads per side from the offline copy with its licence; the link-only version has no text", async () => {
    const storage = memStorage();
    await savePassage(PASSAGE, storage);
    const calls: string[] = [];
    const t = (await loadStudyText(REF, { storage, fetch: noFetch(calls), offline: () => false })) as StudyText;
    expect(t.from).toBe("vault");
    expect(segmentCount(t)).toBe(3);
    const [he, en] = t.versions;
    expect(he).toMatchObject({ free: true, licenseLabel: "CC-BY-SA", direction: "rtl" });
    expect(en).toMatchObject({ free: false, segments: null });
    expect(calls).toEqual([]);
  });

  it("a note that repeats the text is refused; one that points at the segment is kept", () => {
    const doc = new Y.Doc();
    const segs = HE;
    expect(() => addNote(doc, { segment: 1, text: `הפסוק אומר: ${HE[1]}`, name: "A", sourceSegments: segs })).toThrow(SourceTextInNoteError);
    // Niqqud and maqaf don't hide a copy.
    expect(sourceOverlap("והארץ היתה תהו ובהו וחשך על פני תהום", segs)).toBeGreaterThanOrEqual(6);
    const n = addNote(doc, { segment: 1, text: "למה תהו ובהו לפני האור? רש״י כאן", name: "A", sourceSegments: segs });
    expect(listNotes(doc)).toEqual([n]);
  });

  it("no payload — plaintext state, wire messages, presence — contains the source text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-h1-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const app = createCollabServer({ port: 0, host: "127.0.0.1", dataDir: dir, tokenSecret: "x".repeat(40), debounceMs: 20, maxDebounceMs: 50, backupIntervalMs: 0, e2eeOnly: true });
    const url = `ws://127.0.0.1:${await app.listen()}`;
    cleanups.push(() => app.close());
    const wire: Uint8Array[] = [];
    const room = newHavrutaRoomName();
    expect(room.startsWith(HAVRUTA_ROOM_PREFIX)).toBe(true);
    const a = await session(url, room, "study pw", { key: REF.key, he: "בראשית א" }, wire);
    const b = await session(url, room, "study pw", undefined, wire);
    expect(await until(() => roomRef(b.doc)?.key === REF.key)).toBe(true);
    const local = localSegments((await loadStudyText(REF, { storage: await saved(), fetch: noFetch([]), offline: () => true })) as StudyText);
    addNote(a.doc, { segment: 0, text: "מה פירוש בראשית כאן? סמיכות", name: "Dana", sourceSegments: local });
    addHighlight(a.doc, { segment: 1, version: "Miqra according to the Masorah", start: 0, end: 12 });
    a.setPresence({ name: "Dana", color: "#c33", segment: 2, selection: { version: "Miqra according to the Masorah", start: 3, end: 9 } });
    expect(await until(() => listNotes(b.doc).length === 1 && b.awareness.getStates().size === 2)).toBe(true);
    await a.whenIdle();

    const hay = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");
    const plain = hay(Y.encodeStateAsUpdate(a.doc)) + JSON.stringify([...a.awareness.getStates().values()]);
    const words = HE.flatMap((v) => v.split(/[\s־]+/)).filter((w) => w.length > 3);
    for (const w of words) expect(plain.includes(w), `plaintext has ${w}`).toBe(false);
    expect(wire.length).toBeGreaterThan(0);
    // What crossed the wire is ciphertext: not even the note's own words are readable.
    for (const m of wire) {
      const s = hay(m);
      for (const w of [...words, "סמיכות", "Dana"]) expect(s.includes(w), `wire has ${w}`).toBe(false);
    }
  }, 60_000);

  it("two clients sync a note on a segment in under 1 s through a local relay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-h1b-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const app = createCollabServer({ port: 0, host: "127.0.0.1", dataDir: dir, tokenSecret: "x".repeat(40), debounceMs: 20, maxDebounceMs: 50, backupIntervalMs: 0, e2eeOnly: true });
    const url = `ws://127.0.0.1:${await app.listen()}`;
    cleanups.push(() => app.close());
    const room = newHavrutaRoomName();
    const a = await session(url, room, "pw2", { key: REF.key, he: "בראשית א" });
    const b = await session(url, room, "pw2");
    expect(await until(() => roomRef(b.doc) !== null)).toBe(true);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      addNote(a.doc, { segment: i % 3, text: `שאלה ${i} על הקטע`, name: "A", sourceSegments: HE });
      expect(await until(() => listNotes(b.doc).length === i + 1, 5000)).toBe(true);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    // hygiene-allow: the measured sync times, for the PR's verification table
    console.log(`havruta note sync ms: ${times.map((t) => t.toFixed(0)).join(", ")}`);
    expect(times[2]).toBeLessThan(1000); // the median of 5
    expect(notesBySegment(b.doc).get(0)?.theirs).toHaveLength(2);
  }, 60_000);
});

describe("invite by link or QR, no account", () => {
  it("the password is only in the fragment, the reference not at all, and the QR holds the link", () => {
    const room = newHavrutaRoomName(() => new Uint8Array(16).fill(171));
    const link = havrutaInviteLink("https://lumen-md.vercel.app/app?x=1#old", room, "p@ss word");
    expect(link).toBe(`https://lumen-md.vercel.app/app?x=1#havruta=${room}&password=p%40ss%20word`);
    expect(new URL(link).search).toBe("?x=1");
    expect(link).not.toContain("Genesis");
    expect(readHavrutaInvite(link)).toEqual({ room, password: "p@ss word" });
    expect(readHavrutaInvite("#havruta=lumen-abc&password=x")).toBeNull();
    expect(() => havrutaInviteLink("https://x", "lumen-123", "pw")).toThrow();
    const qr = havrutaInviteQr(link);
    expect(qr.size).toBeGreaterThan(21);
    expect(qr.d).toMatch(/^M\d+,\d+h1v1h-1z/);
  });
});

describe("airplane mode", () => {
  it("0 requests to Sefaria: the saved copy, or 'not available offline'", async () => {
    const calls: string[] = [];
    const storage = await saved();
    expect(((await loadStudyText(REF, { storage, fetch: noFetch(calls), offline: () => true })) as StudyText).from).toBe("vault");
    expect(await loadStudyText(parseSourceRef("Exodus 1:1")!, { storage, fetch: noFetch(calls), offline: () => true })).toEqual({ unavailable: "offline" });
    expect(calls).toEqual([]);
  });
});

async function saved() {
  const s = memStorage();
  await savePassage(PASSAGE, s);
  return s;
}

/** A session through the real relay: the app's own wiring (openHavruta) with the real HocuspocusProvider. */
async function session(url: string, room: string, password: string, ref?: { key: string; he: string }, wire?: Uint8Array[]): Promise<HavrutaSession> {
  const serverRoom = await committedRoomName(room, password);
  const connect: HavrutaConnect = async (transport, awareness) => {
    const p = new HocuspocusProvider({ url: roomSocketUrl(url, serverRoom), name: serverRoom, document: transport, awareness, token: async () => (await requestRoomToken(url, serverRoom, null, { password })).token });
    if (wire) {
      // Every message both ways, as bytes.
      p.on("outgoingMessage", (m: { message?: { toUint8Array?: () => Uint8Array } }) => {
        const bytes = m?.message?.toUint8Array?.();
        if (bytes) wire.push(bytes);
      });
      p.on("message", (m: { message?: { data?: Uint8Array } }) => {
        if (m?.message?.data) wire.push(new Uint8Array(m.message.data));
      });
    }
    await new Promise<void>((r) => p.on("synced", () => r()));
    return { destroy: () => p.destroy() };
  };
  const s = await openHavruta({ room, password, ref, connect });
  cleanups.push(() => s.leave());
  return s;
}
