/**
 * Plan W2.20 acceptance 3: "a 1 MB document with 5 participants: 0 loss in
 * 1,000 random edits" — the soak harness.
 *
 * Five participants, each with the app's own end-to-end encrypted transport
 * (src/collab/e2e.ts `wireE2E`: a plaintext Y.Doc that never leaves the tab,
 * and a transport Y.Doc of AES-GCM envelopes), edit one Y.Text ("lumen", the
 * name src/collab/yjs.ts binds the editor to) through a relay that is the
 * public server's room in miniature: every update a participant sends goes
 * through the server's own E2EE-only check (sync-server/collab/relay.mjs
 * `checkE2eeUpdate`, which refuses anything but envelopes) before it enters
 * the room's document, and the room relays what it accepted to the others.
 *
 * The network is hostile in the ways a real one is: each link (participant
 * → room, room → participant) is a FIFO queue like a WebSocket, but which
 * link delivers next is random, so participants see each other's edits in
 * different orders and edit concurrently on stale text; every `churnEvery`
 * edits one participant drops off, keeps editing offline, and rejoins with
 * the state-vector exchange a provider does on reconnect (sync steps 1/2).
 * The envelopes compact into encrypted snapshots on the way (e2e.ts).
 *
 * The edits (seeded, so a failure replays):
 *   - insert: a unique marker «p<participant>e<edit>» at a random place;
 *   - delete: a random short range of the filler text (never a marker);
 *   - replace: both at once.
 *
 * "0 loss" is judged at the end, after every link is drained and every
 * channel is idle:
 *   - the five plaintext documents are identical (convergence);
 *   - every marker ever inserted is in the text exactly once;
 *   - the room refused nothing: every update was a valid envelope, and none
 *     would have taken the room past the server's limit (relay.mjs
 *     createRelayRoom: `bytes + update.byteLength > maxBytes` closes the
 *     sender's connection; `bytes` from the relay's own meter, roomSize.mjs);
 *   - no plaintext crossed the wire or sits in the room: neither a marker
 *     nor a sentence of the filler is found in any byte the relay carried or
 *     in the room's stored state.
 *
 * Run: the unit test src/__tests__/collabSoak.test.ts runs the full size
 * (1 MB, 5, 1,000) with the real yjs; `opts` scale it for a longer soak.
 */
import * as Y from "yjs";
import { wireE2E, type E2EChannel } from "../../src/collab/e2e";
// @ts-expect-error -- plain ESM server module, no types
import { checkE2eeUpdate } from "../../sync-server/collab/relay.mjs";
// @ts-expect-error -- plain ESM server module, no types
import { createRoomMeter } from "../../sync-server/collab/roomSize.mjs";

export interface SoakOptions {
  participants?: number;
  edits?: number;
  /** Size of the starting document, in UTF-8 bytes. */
  docBytes?: number;
  seed?: number;
  /** Every this many edits one participant goes offline (or comes back). */
  churnEvery?: number;
  /** The server room's limit (relay.mjs createRelayRoom maxBytes). */
  roomMaxBytes?: number;
  compactThreshold?: number;
  password?: string;
  room?: string;
  /** Fault injection, for the harness's own control test: true drops this participant's update before the room. */
  dropToRoom?: (from: number) => boolean;
}

export interface SoakResult {
  participants: number;
  edits: number;
  docBytes: number;
  ops: { insert: number; delete: number; replace: number };
  markers: number;
  lost: string[];
  duplicated: string[];
  converged: boolean;
  finalChars: number;
  refused: string[];
  roomBytes: number;
  /** The largest the room was after any accepted update (the relay's meter). */
  roomPeakBytes: number;
  roomMaxBytes: number;
  /** Updates the relay would have refused as too large (each closes the sender's socket). */
  tooLarge: number;
  /** Snapshot envelopes (s: 1) in the room at the end. */
  snapshotsInRoom: number;
  wireBytes: number;
  wireMessages: number;
  plaintextOnWire: string[];
  plaintextInRoom: string[];
  offlineSpells: number;
  envelopes: number[];
  decryptErrors: number;
  ms: number;
}

/** mulberry32: small, seeded, good enough to pick edits. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SENTENCES = [
  "הפרוטוקול של ישיבת הוועדה נכתב בזמן אמת ונשמר בכספת.",
  "The committee reviewed the budget line by line before the vote.",
  "בסעיף השלישי הוחלט להעביר את הדיון לשבוע הבא.",
  "Every participant edits the same note from a different city.",
  "השרת רואה רק מעטפות מוצפנות ולא את תוכן הפתק.",
];

/** A filler document of `bytes` UTF-8 bytes, one sentence per line. */
export function fillerDocument(bytes: number): string {
  const lines: string[] = [];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    const line = `${SENTENCES[i % SENTENCES.length]} (${i})\n`;
    lines.push(line);
    size += new TextEncoder().encode(line).byteLength;
  }
  return lines.join("");
}

const MARKER = /«p\d+e\d+»/g;

interface Peer {
  id: number;
  plain: Y.Doc;
  transport: Y.Doc;
  channel: E2EChannel;
  online: boolean;
  errors: number;
}

/** Does `hay` contain the UTF-8 bytes of `needle`? (Node's Buffer search when there is one.) */
function hasBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  const B = (globalThis as { Buffer?: { from(b: ArrayBuffer, o: number, l: number): { indexOf(n: Uint8Array): number } } }).Buffer;
  if (B) return B.from(hay.buffer as ArrayBuffer, hay.byteOffset, hay.byteLength).indexOf(needle) >= 0;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export async function runSoak(opts: SoakOptions = {}): Promise<SoakResult> {
  const n = opts.participants ?? 5;
  const edits = opts.edits ?? 1000;
  const docBytes = opts.docBytes ?? 1_000_000;
  const churnEvery = opts.churnEvery ?? 100;
  const roomMaxBytes = opts.roomMaxBytes ?? 4_000_000;
  const password = opts.password ?? "correct horse battery staple";
  const room = opts.room ?? "lumen-soak-room-7";
  const rand = rng(opts.seed ?? 20_261_117);
  const t0 = performance.now();

  // ── the room and the links ──
  const server = new Y.Doc();
  const meter = createRoomMeter(server) as { measure(): number };
  let roomBytes = 0;
  let roomPeakBytes = 0;
  let tooLarge = 0;
  const NET = "net";
  const up: Uint8Array[][] = Array.from({ length: n }, () => []); // participant → room
  const down: Uint8Array[][] = Array.from({ length: n }, () => []); // room → participant
  const refused: string[] = [];
  let wireBytes = 0;
  let wireMessages = 0;
  const wireSample: Uint8Array[] = [];
  const carry = (u: Uint8Array) => {
    wireBytes += u.byteLength;
    wireMessages++;
    // Every message is searched at the end; keep them all (a few MB at most).
    wireSample.push(u);
  };
  server.on("update", (u: Uint8Array, origin: unknown) => {
    for (let i = 0; i < n; i++) if (i !== origin && peers[i].online) down[i].push(u);
  });

  // ── the participants ──
  const peers: Peer[] = [];
  for (let i = 0; i < n; i++) {
    const plain = new Y.Doc();
    const transport = new Y.Doc();
    const p: Peer = { id: i, plain, transport, channel: null as unknown as E2EChannel, online: true, errors: 0 };
    p.channel = wireE2E(plain, transport, { password, room, compactThreshold: opts.compactThreshold, onDecryptError: () => p.errors++ });
    transport.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== NET && p.online) up[i].push(u);
    });
    peers.push(p);
  }

  const deliverUp = (i: number) => {
    const u = up[i].shift()!;
    carry(u);
    if (opts.dropToRoom?.(i)) return;
    const why = checkE2eeUpdate(server, u) as string | null;
    if (why) return void refused.push(`participant ${i}: ${why}`);
    // The relay's size rule. The soak counts the refusal and applies the update anyway, to keep measuring.
    if (roomBytes + u.byteLength > roomMaxBytes) tooLarge++;
    Y.applyUpdate(server, u, i);
    roomBytes = meter.measure();
    roomPeakBytes = Math.max(roomPeakBytes, roomBytes);
  };
  const deliverDown = (i: number) => {
    const u = down[i].shift()!;
    carry(u);
    Y.applyUpdate(peers[i].transport, u, NET);
  };
  /** Deliver up to `k` messages, each from a random non-empty link. */
  const pump = (k: number) => {
    for (let s = 0; s < k; s++) {
      const links: Array<() => void> = [];
      for (let i = 0; i < n; i++) {
        if (up[i].length) links.push(() => deliverUp(i));
        if (down[i].length) links.push(() => deliverDown(i));
      }
      if (!links.length) return;
      links[Math.floor(rand() * links.length)]();
    }
  };
  const idle = async () => Promise.all(peers.map((p) => p.channel.whenIdle()));
  /** Drain every link and every channel until nothing moves. */
  const drain = async () => {
    for (let round = 0; round < 200; round++) {
      await idle();
      const pending = up.some((q) => q.length) || down.some((q) => q.length);
      if (!pending) {
        await idle();
        if (!(up.some((q) => q.length) || down.some((q) => q.length))) return;
      }
      pump(1_000_000);
    }
    throw new Error("the soak network did not settle");
  };
  const goOffline = (p: Peer) => {
    p.online = false;
    up[p.id].length = 0; // a dropped socket loses what it had not sent
    down[p.id].length = 0;
  };
  const goOnline = (p: Peer) => {
    p.online = true;
    // A provider's reconnect: both sides send what the other's state vector lacks.
    up[p.id].push(Y.encodeStateAsUpdate(p.transport, Y.encodeStateVector(server)));
    down[p.id].push(Y.encodeStateAsUpdate(server, Y.encodeStateVector(p.transport)));
  };

  // ── the 1 MB document, written by participant 0 and synced to all ──
  const filler = fillerDocument(docBytes);
  peers[0].plain.getText("lumen").insert(0, filler);
  await drain();

  // ── 1,000 random edits ──
  const inserted: string[] = [];
  const ops = { insert: 0, delete: 0, replace: 0 };
  let offlineSpells = 0;
  let away: Peer | null = null;
  for (let e = 0; e < edits; e++) {
    if (e > 0 && e % churnEvery === 0) {
      if (away) {
        goOnline(away);
        away = null;
      } else {
        away = peers[1 + Math.floor(rand() * (n - 1))];
        goOffline(away);
        offlineSpells++;
      }
    }
    const p = peers[Math.floor(rand() * n)];
    const text = p.plain.getText("lumen");
    const s = text.toString();
    const r = rand();
    const kind: keyof typeof ops = r < 0.6 ? "insert" : r < 0.85 ? "delete" : "replace";
    p.plain.transact(() => {
      if (kind !== "insert") {
        // A short range of filler with no marker in it (a marker is only ever removed by losing it).
        for (let tries = 0; tries < 20; tries++) {
          const at = Math.floor(rand() * Math.max(1, s.length - 40));
          const len = 1 + Math.floor(rand() * 24);
          // The range and a margin around it hold no marker character.
          if (!/[«»]/.test(s.slice(Math.max(0, at - 12), at + len + 12))) {
            text.delete(at, len);
            break;
          }
        }
      }
      if (kind !== "delete") {
        const marker = `«p${p.id}e${e}»`;
        // Not inside another marker.
        let at = Math.floor(rand() * (text.length + 1));
        const now = text.toString();
        const open = now.lastIndexOf("«", at - 1);
        if (open >= 0 && now.indexOf("»", open) >= at) at = now.indexOf("»", open) + 1;
        text.insert(at, marker);
        inserted.push(marker);
      }
    });
    ops[kind]++;
    // Encryption is async: let some of it run, then let the network move a little.
    if (rand() < 0.3) await idle();
    pump(Math.floor(rand() * 8));
  }
  if (away) goOnline(away);
  await drain();

  // ── judge ──
  const finals = peers.map((p) => p.plain.getText("lumen").toString());
  const converged = finals.every((f) => f === finals[0]);
  const counts = new Map<string, number>();
  for (const m of finals[0].match(MARKER) ?? []) counts.set(m, (counts.get(m) ?? 0) + 1);
  const lost = inserted.filter((m) => !counts.has(m));
  const duplicated = [...counts].filter(([, c]) => c > 1).map(([m]) => m);
  const enc = new TextEncoder();
  const probes = [...SENTENCES, ...inserted.slice(0, 50)];
  const stored = Y.encodeStateAsUpdate(server);
  const plaintextOnWire = probes.filter((pr) => wireSample.some((u) => hasBytes(u, enc.encode(pr))));
  const plaintextInRoom = probes.filter((pr) => hasBytes(stored, enc.encode(pr)));
  const result: SoakResult = {
    participants: n,
    edits,
    docBytes: enc.encode(filler).byteLength,
    ops,
    markers: inserted.length,
    lost,
    duplicated,
    converged,
    finalChars: finals[0].length,
    refused,
    roomBytes: stored.byteLength,
    roomPeakBytes,
    roomMaxBytes,
    tooLarge,
    snapshotsInRoom: server.getArray<{ s?: number }>("e2e").toArray().filter((e) => e?.s === 1).length,
    wireBytes,
    wireMessages,
    plaintextOnWire,
    plaintextInRoom,
    offlineSpells,
    envelopes: peers.map((p) => p.channel.envelopeCount()),
    decryptErrors: peers.reduce((a, p) => a + p.errors, 0),
    ms: Math.round(performance.now() - t0),
  };
  for (const p of peers) p.channel.destroy();
  return result;
}

/** The verdict: every reason the soak failed, empty when it passed. */
export function soakProblems(r: SoakResult): string[] {
  const out: string[] = [];
  if (!r.converged) out.push("the participants' documents differ");
  if (r.lost.length) out.push(`${r.lost.length} inserted markers lost (${r.lost.slice(0, 5).join(" ")})`);
  if (r.duplicated.length) out.push(`${r.duplicated.length} markers duplicated`);
  if (r.refused.length) out.push(`the room refused ${r.refused.length} updates (${r.refused[0]})`);
  if (r.tooLarge || r.roomPeakBytes > r.roomMaxBytes) out.push(`the room grew to ${r.roomPeakBytes} bytes, over the server's ${r.roomMaxBytes}: the relay would have closed ${r.tooLarge} connections`);
  if (r.plaintextOnWire.length) out.push(`plaintext on the wire: ${r.plaintextOnWire[0]}`);
  if (r.plaintextInRoom.length) out.push(`plaintext in the room: ${r.plaintextInRoom[0]}`);
  if (r.decryptErrors) out.push(`${r.decryptErrors} envelopes failed to decrypt`);
  return out;
}
