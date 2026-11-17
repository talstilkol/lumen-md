// @vitest-environment node
/**
 * Plan W12.H3 — havruta offline and at the end.
 *
 *  - Two sides that edit while cut off from each other (10 minutes of notes
 *    each, offline from the start) merge with no note lost once they reach
 *    the relay; the notes survive a reload on the device meanwhile.
 *  - "End session" deletes the room on the relay: before it the relay
 *    answers 200 for the room, after it 404. The partner is told the
 *    session ended. Both relays: the self-hosted Node server (real, over
 *    sockets) and the public Worker (its code, on a small fake of the
 *    Durable Object storage).
 *  - "End session" also takes the room out of the Node relay's backups
 *    (coordinator decision): no backup holds its rows or its ciphertext
 *    bytes afterwards, while other rooms stay in them.
 *  - Retention: a study room nobody touched for 30 days is deleted, while
 *    other rooms keep the server's own retention.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { roomSocketUrl } from "../collab/persistentProvider";
import { committedRoomName, roomProof } from "../collab/roomProof";
import { requestRoomToken } from "../collab/roomToken";
import { addNote, listNotes, newHavrutaRoomName } from "../havruta/room";
import { openHavruta, type HavrutaConnect, type HavrutaPersist } from "../havruta/session";
import { deleteRoomOnRelay, roomStatusOnRelay } from "../havruta/relayAdmin";
// @ts-expect-error -- plain ESM server module, no types
import { createCollabServer, HAVRUTA_RETENTION_DAYS } from "../../sync-server/collab-server.mjs";
// @ts-expect-error -- plain ESM server module, no types
import { CollabRoom, retentionMs, roomAdmin } from "../../edge-workers/collab/worker.mjs";
// @ts-expect-error -- plain ESM server module, no types
import { roomOf } from "../../sync-server/collab/sharing.mjs";

const DAY = 24 * 60 * 60 * 1000;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
async function until(fn: () => boolean | Promise<boolean>, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

async function server() {
  const dir = mkdtempSync(join(tmpdir(), "lumen-h3-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const app = createCollabServer({ port: 0, host: "127.0.0.1", dataDir: dir, tokenSecret: "y".repeat(40), debounceMs: 10, maxDebounceMs: 30, backupIntervalMs: 0, e2eeOnly: true });
  const url = `ws://127.0.0.1:${await app.listen()}`;
  cleanups.push(() => app.close());
  return { app, url, dir };
}

/** The device's store (IndexedDB in the app): a Map here, kept across "reloads". */
const memPersist = (): HavrutaPersist & { data: Map<string, Uint8Array> } => {
  const data = new Map<string, Uint8Array>();
  return { data, load: async (r) => data.get(r) ?? null, save: async (r, s) => void data.set(r, s), clear: async (r) => void data.delete(r) };
};

/** The relay link through the real HocuspocusProvider, refused while `offline()` (no network). */
const relay = (url: string, room: string, password: string, offline: () => boolean): HavrutaConnect => async (transport, awareness) => {
  if (offline()) throw new Error("offline");
  const serverRoom = await committedRoomName(room, password);
  const p = new HocuspocusProvider({ url: roomSocketUrl(url, serverRoom), name: serverRoom, document: transport, awareness, token: async () => (await requestRoomToken(url, serverRoom, null, { password })).token });
  await new Promise<void>((r) => p.on("synced", () => r()));
  return { destroy: () => p.destroy() };
};

describe("offline: start without a network, merge when the partner connects", () => {
  it("two sides edit cut off for 10 minutes and merge with no note lost; a reload keeps them", async () => {
    const { url } = await server();
    const room = newHavrutaRoomName();
    const pw = "offline pw";
    let offline = true;
    const pa = memPersist();
    const pb = memPersist();
    const a = await openHavruta({ room, password: pw, ref: { key: "Berakhot.2a", he: "ברכות ב׳ א׳" }, connect: relay(url, room, pw, () => offline), persist: pa, persistDelayMs: 5 });
    const b0 = await openHavruta({ room, password: pw, connect: relay(url, room, pw, () => offline), persist: pb, persistDelayMs: 5 });
    expect([a.online, b0.online]).toEqual([false, false]);
    const t0 = Date.UTC(2026, 10, 15, 8, 0);
    // Ten minutes of study on each side, one note a minute, with no network.
    for (let m = 0; m < 10; m++) {
      addNote(a.doc, { segment: m % 4, text: `שאלה של א בדקה ${m}`, name: "A", sourceSegments: [] }, t0 + m * 60_000);
      addNote(b0.doc, { segment: m % 4, text: `תשובה של ב בדקה ${m}`, name: "B", sourceSegments: [] }, t0 + m * 60_000 + 30_000);
    }
    // B's device reloads in the middle: the notes come back from the device.
    await b0.leave();
    const b = await openHavruta({ room, password: pw, connect: relay(url, room, pw, () => offline), persist: pb, persistDelayMs: 5 });
    cleanups.push(() => a.leave(), () => b.leave());
    expect(listNotes(b.doc)).toHaveLength(10);
    // The network comes back.
    offline = false;
    expect(await a.reconnect()).toBe(true);
    expect(await b.reconnect()).toBe(true);
    expect(await until(() => listNotes(a.doc).length === 20 && listNotes(b.doc).length === 20)).toBe(true);
    expect(listNotes(a.doc).map((n) => n.text)).toEqual(listNotes(b.doc).map((n) => n.text));
    expect(listNotes(a.doc)[0].text).toBe("שאלה של א בדקה 0");
    expect(listNotes(b.doc).at(-1)?.text).toBe("תשובה של ב בדקה 9");
  }, 60_000);
});

describe("end session: the relay deletes the room", () => {
  it("Node relay: 200 before, 404 after; the partner hears it ended; the device forgets the room", async () => {
    const { url } = await server();
    const room = newHavrutaRoomName();
    const pw = "end pw";
    const target = { serverUrl: url, room, password: pw };
    const pa = memPersist();
    let ended = false;
    const a = await openHavruta({ room, password: pw, ref: { key: "Berakhot.2a", he: "ברכות ב׳ א׳" }, connect: relay(url, room, pw, () => false), persist: pa, persistDelayMs: 5, deleteOnRelay: () => deleteRoomOnRelay(target) });
    const b = await openHavruta({ room, password: pw, connect: relay(url, room, pw, () => false), onEnded: () => (ended = true) });
    cleanups.push(() => b.leave());
    addNote(a.doc, { segment: 0, text: "סיכום הסוגיה", name: "A", sourceSegments: [] });
    expect(await until(() => listNotes(b.doc).length === 1)).toBe(true);
    // Stored once the server's debounce has passed.
    expect(await until(async () => (await roomStatusOnRelay(target)) === 200)).toBe(true);
    await a.end();
    expect(await until(() => ended)).toBe(true);
    await b.leave();
    expect(await roomStatusOnRelay(target)).toBe(404);
    // Still 404 a moment later: the closed document was not stored again on unload.
    await new Promise((r) => setTimeout(r, 200));
    expect(await roomStatusOnRelay(target)).toBe(404);
    expect(pa.data.has(room)).toBe(false);
  }, 60_000);

  it("Node relay: End session takes the room out of every backup, not only the live database", async () => {
    const { app, url, dir } = await server();
    const room = newHavrutaRoomName();
    const pw = "backup pw";
    const target = { serverUrl: url, room, password: pw };
    // The relay stores the room under the committed name's base.
    const serverRoom = roomOf(await committedRoomName(room, pw)) as string;
    const a = await openHavruta({ room, password: pw, ref: { key: "Berakhot.2a", he: "ברכות ב׳ א׳" }, connect: relay(url, room, pw, () => false), deleteOnRelay: () => deleteRoomOnRelay(target) });
    cleanups.push(() => a.leave());
    addNote(a.doc, { segment: 0, text: "הערה שתימחק", name: "A", sourceSegments: [] });
    expect(await until(async () => (await roomStatusOnRelay(target)) === 200)).toBe(true);
    // Another room, which the purge must leave alone.
    app.store.save("lumen-keep", Y.encodeStateAsUpdate(new Y.Doc()), Date.now());
    const stored = app.store.load(serverRoom) as Uint8Array;
    expect(stored.length).toBeGreaterThan(64);
    // The room's ciphertext, as bytes the backups are searched for.
    const probe = Buffer.from(stored.subarray(stored.length - 48));
    const backups = [app.backup(), app.backup(), app.backup()] as string[];
    const inFile = (f: string) => readFileSync(f).includes(probe);
    const rows = (f: string) => {
      const db = new DatabaseSync(f, { readOnly: true });
      try {
        const n = (sql: string, ...args: string[]) => Number((db.prepare(sql).get(...args) as { n: number }).n);
        return {
          room: n("SELECT count(*) AS n FROM documents WHERE name = ? OR name = ?", serverRoom, `${serverRoom}~comments`) + n("SELECT count(*) AS n FROM room_owners WHERE room = ?", serverRoom) + n("SELECT count(*) AS n FROM shares WHERE room = ?", serverRoom),
          keep: n("SELECT count(*) AS n FROM documents WHERE name = ?", "lumen-keep"),
        };
      } finally {
        db.close();
      }
    };
    // Before: every backup holds the room, rows and ciphertext.
    for (const f of backups) {
      expect(inFile(f), `${f} before`).toBe(true);
      expect(rows(f).room).toBeGreaterThan(0);
    }
    await a.end();
    expect(await roomStatusOnRelay(target)).toBe(404);
    const after = readdirSync(join(dir, "backups")).filter((f: string) => f.endsWith(".sqlite")).map((f: string) => join(dir, "backups", f));
    expect(after.sort()).toEqual([...backups].sort());
    for (const f of after) {
      expect(inFile(f), `${f} still has the room's ciphertext`).toBe(false);
      expect(rows(f)).toEqual({ room: 0, keep: 1 });
    }
    // A backup taken afterwards doesn't have it either.
    const next = app.backup() as string;
    expect([inFile(next), rows(next)]).toEqual([false, { room: 0, keep: 1 }]);
  }, 60_000);

  it("Node relay: a delete without a valid room token is refused", async () => {
    const { url } = await server();
    const ask = (payload: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const ws = new WebSocket(`${url}/token`);
        ws.onopen = () => ws.send(JSON.stringify(payload));
        ws.onmessage = (e) => resolve(JSON.parse(String(e.data)));
        ws.onerror = () => reject(new Error("socket"));
      });
    expect(await ask({ action: "delete", room: "havruta-00", token: "nope.nope" })).toEqual({ error: "unauthorized" });
    expect(await ask({ action: "exists", room: "havruta-00" })).toEqual({ error: "unauthorized" });
  }, 30_000);

  it("public Worker: exists 200 → delete → 404, only with the proof the name commits to", async () => {
    const room = newHavrutaRoomName();
    const pw = "worker pw";
    const name = await committedRoomName(room, pw);
    const proof = await roomProof(pw, room);
    const objects = new Map<string, InstanceType<typeof CollabRoom>>();
    const env: Record<string, unknown> = { RETENTION_DAYS: "90" };
    env.ROOMS = { idFromName: (n: string) => n, get: (id: string) => objects.get(id) ?? fake(id) };
    function fake(id: string) {
      const data = new Map<string, unknown>([["name", id], ["chunks", 1], ["s0", new Uint8Array([0, 0])], ["lastWrite", Date.now()]]);
      const state = { id: { toString: () => id }, storage: { get: async (k: string | string[]) => (Array.isArray(k) ? new Map(k.filter((x) => data.has(x)).map((x) => [x, data.get(x)])) : data.get(k)), put: async (o: Record<string, unknown>) => Object.entries(o).forEach(([k, v]) => data.set(k, v)), delete: async (k: string | string[]) => [k].flat().forEach((x) => data.delete(x)), deleteAll: async () => data.clear(), setAlarm: async () => {}, deleteAlarm: async () => {} }, getWebSockets: () => [] };
      const o = new CollabRoom(state, env);
      objects.set(id, o);
      return o;
    }
    expect(await roomAdmin({ action: "exists", room: name, proof }, env)).toEqual({ status: 200 });
    expect(await roomAdmin({ action: "delete", room: name, proof: await roomProof("wrong", room) }, env)).toEqual({ error: "commitment" });
    expect(await roomAdmin({ action: "delete", room: room, proof }, env)).toEqual({ error: "commitment" });
    expect(await roomAdmin({ action: "exists", room: name, proof }, env)).toEqual({ status: 200 });
    expect(await roomAdmin({ action: "delete", room: name, proof }, env)).toEqual({ deleted: true, status: 404 });
    expect(await roomAdmin({ action: "exists", room: name, proof }, env)).toEqual({ status: 404 });
  }, 30_000);
});

describe("retention: a study room untouched for 30 days is deleted", () => {
  it("Node relay: a havruta room goes after 30 days, another room keeps the server's 90", async () => {
    const { app } = await server();
    const now = Date.UTC(2026, 10, 15);
    const state = Y.encodeStateAsUpdate(new Y.Doc());
    app.store.save("havruta-aaaa", state, now - 31 * DAY);
    app.store.save("havruta-bbbb", state, now - 29 * DAY);
    app.store.save("lumen-cccc", state, now - 31 * DAY);
    expect(HAVRUTA_RETENTION_DAYS).toBe(30);
    app.sweep(now);
    expect([app.store.load("havruta-aaaa"), app.store.load("havruta-bbbb") !== null, app.store.load("lumen-cccc") !== null]).toEqual([null, true, true]);
  }, 30_000);

  it("Worker: 30 days for a study room (also when RETENTION_DAYS is longer or off), RETENTION_DAYS for the rest", () => {
    expect(retentionMs("havruta-00_kabc", { RETENTION_DAYS: "90" })).toBe(30 * DAY);
    expect(retentionMs("havruta-00_kabc", { RETENTION_DAYS: "7" })).toBe(7 * DAY);
    expect(retentionMs("havruta-00_kabc", { RETENTION_DAYS: "0" })).toBe(30 * DAY);
    expect(retentionMs("lumen-00", { RETENTION_DAYS: "90" })).toBe(90 * DAY);
    expect(retentionMs("lumen-00", {})).toBe(90 * DAY);
  });
});
