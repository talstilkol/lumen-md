/**
 * Review of train 5 (W9.4), H1 and H2: crafted Yjs updates against the
 * relay's E2EE check (sync-server/collab/relay.mjs), which reads only the
 * update's structs.
 *
 *  - H1: a client named in two blocks of one update. Yjs integrates only the
 *    last block, so the check reasoned about a struct Yjs never saw, and a
 *    plaintext item waited in pendingStructs until a second update let it in.
 *    Now refused; and a room drops anything left pending (and closes its sender).
 *  - H2: an item whose origin is itself, a two-item origin cycle, and an item
 *    whose parent is itself hung the check or overflowed its stack. Now "malformed".
 *  - The reviewer's differential fuzz: hand-made V1 updates (duplicate client
 *    blocks, self and forward references, overlaps, GC / Skip neighbours,
 *    parent ids, parentSub, flipped bits) against #469's probe check as the
 *    oracle: no update the oracle refuses is accepted. Each accepted update is
 *    also sent to a relay room, whose kept size must stay exact and whose
 *    array must hold only envelopes.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
// @ts-expect-error -- plain ESM server module, no types
import { checkE2eeUpdate, createRelayRoom } from "../../sync-server/collab/relay.mjs";

type Check = (doc: Y.Doc, update: Uint8Array) => string | null;
const check = checkE2eeUpdate as Check;
type Relay = {
  doc: Y.Doc;
  size: number;
  join(s: { send(b: Uint8Array): void; close(c: number, r?: string): void }): { receive(b: Uint8Array): Promise<void> };
};
const relayRoom = createRelayRoom as (o: { name: string; state?: Uint8Array | null; authorize: () => Promise<boolean>; e2eeOnly?: boolean }) => Relay;

const isEnvelope = (x: unknown): boolean => {
  if (!x || typeof x !== "object" || Array.isArray(x) || x instanceof Uint8Array) return false;
  const o = x as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== "v" && k !== "iv" && k !== "ct" && k !== "s")) return false;
  return typeof o.v === "number" && Number.isInteger(o.v) && o.iv instanceof Uint8Array && o.iv.byteLength === 12 && o.ct instanceof Uint8Array && o.ct.byteLength >= 16 && (o.s === undefined || o.s === 1);
};
const hasContent = <T,>(t: Y.AbstractType<T>) => t._start !== null || t._map.size > 0;

/** The check as #469 shipped it (the oracle): apply the room and the update to a probe and look at everything. */
function probeCheck(doc: Y.Doc, update: Uint8Array): string | null {
  const probe = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(probe, update);
  } catch {
    probe.destroy();
    return "malformed";
  }
  try {
    if (probe.store.pendingStructs !== null || probe.store.pendingDs !== null) return "incomplete";
    for (const [name, type] of probe.share) if (name !== "e2e" && hasContent(type)) return "plaintext";
    const raw = probe.share.get("e2e");
    if (!raw) return null;
    if (raw._map.size > 0) return "plaintext";
    for (const item of probe.getArray("e2e").toArray()) if (!isEnvelope(item)) return "not-envelope";
    return null;
  } finally {
    probe.destroy();
  }
}

const env = () => ({ v: 1, iv: new Uint8Array(12), ct: new Uint8Array(16) });
type Id = [number, number];
type Content = { kind: "deleted"; len: number } | { kind: "string"; s: string } | { kind: "any"; arr: unknown[] } | { kind: "type"; typeRef: number };
type Spec = { gc: true; len: number } | { skip: true; len: number } | { origin: Id | null; right: Id | null; parent?: string | Id; parentSub?: string; content: Content };
type Block = { client: number; clock: number; structs: Spec[] };

const writeId = (e: encoding.Encoder, id: Id) => (encoding.writeVarUint(e, id[0]), encoding.writeVarUint(e, id[1]));
function writeStruct(e: encoding.Encoder, s: Spec) {
  if ("gc" in s) return (encoding.writeUint8(e, 0), encoding.writeVarUint(e, s.len));
  if ("skip" in s) return (encoding.writeUint8(e, 10), encoding.writeVarUint(e, s.len));
  const ref = { deleted: 1, string: 4, any: 8, type: 7 }[s.content.kind];
  encoding.writeUint8(e, ref | (s.origin ? 128 : 0) | (s.right ? 64 : 0) | (s.parentSub != null ? 32 : 0));
  if (s.origin) writeId(e, s.origin);
  if (s.right) writeId(e, s.right);
  if (!s.origin && !s.right) {
    if (typeof s.parent === "string") (encoding.writeVarUint(e, 1), encoding.writeVarString(e, s.parent));
    else (encoding.writeVarUint(e, 0), writeId(e, s.parent ?? [0, 0]));
    if (s.parentSub != null) encoding.writeVarString(e, s.parentSub);
  }
  const c = s.content;
  if (c.kind === "deleted") encoding.writeVarUint(e, c.len);
  else if (c.kind === "string") encoding.writeVarString(e, c.s);
  else if (c.kind === "any") {
    encoding.writeVarUint(e, c.arr.length);
    for (const x of c.arr) encoding.writeAny(e, x as never);
  } else encoding.writeVarUint(e, c.typeRef);
}
const lenOf = (s: Spec) =>
  "gc" in s || "skip" in s ? s.len : s.content.kind === "deleted" ? s.content.len : s.content.kind === "string" ? s.content.s.length : s.content.kind === "any" ? s.content.arr.length : 1;
function encode(blocks: Block[], ds: [number, [number, number][]][] = []): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, blocks.length);
  for (const b of blocks) {
    encoding.writeVarUint(e, b.structs.length);
    encoding.writeVarUint(e, b.client);
    encoding.writeVarUint(e, b.clock);
    for (const s of b.structs) writeStruct(e, s);
  }
  encoding.writeVarUint(e, ds.length);
  for (const [client, ranges] of ds) {
    encoding.writeVarUint(e, client);
    encoding.writeVarUint(e, ranges.length);
    for (const [c, l] of ranges) (encoding.writeVarUint(e, c), encoding.writeVarUint(e, l));
  }
  return encoding.toUint8Array(e);
}

function oneEnvelopeRoom() {
  const a = new Y.Doc();
  a.clientID = 1;
  a.getArray("e2e").push([env()]);
  const room = new Y.Doc();
  Y.applyUpdate(room, Y.encodeStateAsUpdate(a));
  return room;
}

/** A relay room holding `room`'s state, with one authenticated peer; `send(u)` delivers an update. */
async function relayOf(room: Y.Doc | null, e2eeOnly = true) {
  const relay = relayRoom({ name: "r", state: room ? Y.encodeStateAsUpdate(room) : null, authorize: async () => true, e2eeOnly });
  const closed: string[] = [];
  const peer = relay.join({ send: () => undefined, close: (c, r) => closed.push(`${c} ${r ?? ""}`) });
  await peer.receive(new Uint8Array([1, 114, 2, 0, 1, 120])); // Auth, token "x", address "r"
  const send = async (u: Uint8Array) => {
    const len: number[] = [];
    let n = u.byteLength;
    while (n > 127) {
      len.push((n & 127) | 128);
      n >>>= 7;
    }
    len.push(n);
    await peer.receive(new Uint8Array([1, 114, 0, 2, ...len, ...u])); // Sync, update
  };
  return { relay, closed, send };
}

// H1, the reviewer's two stages: block A = 9@0 a GC; block B = 9@1 plaintext after 9:0.
const stage1 = encode([
  { client: 9, clock: 0, structs: [{ gc: true, len: 1 }] },
  { client: 9, clock: 1, structs: [{ origin: [9, 0], right: null, content: { kind: "string", s: "PLAINTEXT secret" } }] },
]);
// Then 9:0 itself, an ordinary envelope after the room's 1:0.
const stage2 = encode([{ client: 9, clock: 0, structs: [{ origin: [1, 0], right: null, content: { kind: "any", arr: [env()] } }] }]);

describe("relay E2EE check: review of train 5, H1 and H2", () => {
  it("refuses an update that names a client in two blocks (H1)", () => {
    const room = oneEnvelopeRoom();
    expect(probeCheck(room, stage1)).toBe("incomplete");
    expect(check(room, stage1)).toBe("malformed");
    // The same client in two blocks, both of them envelopes: still refused (Yjs would drop the first).
    const twice = encode([
      { client: 9, clock: 0, structs: [{ origin: [1, 0], right: null, content: { kind: "any", arr: [env()] } }] },
      { client: 9, clock: 1, structs: [{ origin: [9, 0], right: null, content: { kind: "any", arr: [env()] } }] },
    ]);
    expect(check(room, twice)).toBe("malformed");
    // One block per client: accepted.
    expect(check(room, stage2)).toBeNull();
  });

  it("keeps the plaintext out of a relay room through both stages (H1)", async () => {
    const { relay, closed, send } = await relayOf(oneEnvelopeRoom());
    await send(stage1);
    expect(closed).toEqual(["4403 e2ee-only: malformed"]);
    expect(relay.doc.store.pendingStructs).toBeNull();
    const second = await relayOf(relay.doc); // a new connection to the room as it is now
    await second.send(stage2);
    expect(second.closed).toEqual([]);
    const items = second.relay.doc.getArray("e2e").toArray();
    expect(items).toHaveLength(2);
    expect(items.every(isEnvelope)).toBe(true);
  });

  it("drops what an update leaves pending and closes its sender, whatever the check said", async () => {
    // e2eeOnly off, so the check does not run: the room's own net still holds.
    const { relay, closed, send } = await relayOf(oneEnvelopeRoom(), false);
    await send(encode([{ client: 9, clock: 1, structs: [{ origin: [9, 0], right: null, content: { kind: "string", s: "waits for 9:0" } }] }]));
    expect(closed).toEqual(["4403 e2ee-only: incomplete"]);
    expect(relay.doc.store.pendingStructs).toBeNull();
    expect(relay.doc.store.pendingDs).toBeNull();
    await send(encode([], [[9, [[5, 1]]]])); // a deletion of what nobody has: pendingDs
    expect(relay.doc.store.pendingDs).toBeNull();
    expect(relay.size).toBe(Y.encodeStateAsUpdate(relay.doc).byteLength);
  });

  it("answers malformed, at once, to a self origin, an origin cycle and a self parent (H2)", () => {
    const room = oneEnvelopeRoom();
    const self = encode([{ client: 9, clock: 0, structs: [{ origin: [9, 0], right: null, content: { kind: "string", s: "x" } }] }]);
    const cycle = encode([
      {
        client: 9,
        clock: 0,
        structs: [
          { origin: [9, 1], right: null, content: { kind: "string", s: "x" } },
          { origin: [9, 0], right: null, content: { kind: "string", s: "y" } },
        ],
      },
    ]);
    const parent = encode([{ client: 9, clock: 0, structs: [{ origin: null, right: null, parent: [9, 0], content: { kind: "string", s: "x" } }] }]);
    const rightSelf = encode([{ client: 9, clock: 0, structs: [{ origin: null, right: [9, 0], content: { kind: "any", arr: [env()] } }] }]);
    for (const u of [self, cycle, parent, rightSelf]) {
      const t = performance.now();
      expect(check(room, u)).toBe("malformed");
      expect(performance.now() - t).toBeLessThan(1000);
      expect(probeCheck(room, u)).not.toBeNull();
    }
  });

  it("walks a long chain of parents without recursion", () => {
    // 20,000 nested items, each the parent of the next: a recursive walk would overflow the stack.
    const n = 20_000;
    const structs: Spec[] = [{ origin: null, right: null, parent: "e2e", content: { kind: "type", typeRef: 1 } }];
    for (let i = 1; i < n; i++) structs.push({ origin: null, right: null, parent: [9, i - 1], parentSub: "k", content: { kind: "type", typeRef: 1 } });
    const u = encode([{ client: 9, clock: 0, structs }]);
    expect(check(new Y.Doc(), u)).toBe("not-envelope");
  });

  it("accepts nothing the probe check refuses, over 3,000 crafted updates per seed, and the room stays exact", async () => {
    let seed = 0;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const randContent = (): Content =>
      pick<() => Content>([
        () => ({ kind: "any", arr: [env()] }),
        () => ({ kind: "any", arr: [env(), env()] }),
        () => ({ kind: "any", arr: ["secret"] }),
        () => ({ kind: "string", s: "secret" }),
        () => ({ kind: "deleted", len: 1 }),
        () => ({ kind: "type", typeRef: pick([0, 1, 2]) }),
      ])();
    const makeRoom = () => {
      const d = new Y.Doc();
      d.clientID = 1;
      const a = d.getArray("e2e");
      const n = 1 + Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) a.insert(Math.floor(rnd() * (a.length + 1)), [env()]);
      if (rnd() < 0.5 && a.length > 1) a.delete(0, 1);
      const r = new Y.Doc();
      Y.applyUpdate(r, Y.encodeStateAsUpdate(d));
      return r;
    };
    const randUpdate = (r: Y.Doc) => {
      const roomClock = Y.getState(r.store, 1);
      const clients = [1, 7, 8, 9];
      const ids: Id[] = [];
      for (let c = 0; c < roomClock; c++) ids.push([1, c]);
      const blocks: Block[] = [];
      const nb = 1 + Math.floor(rnd() * 4);
      for (let b = 0; b < nb; b++) {
        const client = pick(clients);
        let clock = client === 1 ? Math.floor(rnd() * (roomClock + 2)) : Math.floor(rnd() * 2);
        const block: Block = { client, clock, structs: [] };
        const ns = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < ns; i++) {
          let s: Spec;
          const k = rnd();
          if (k < 0.1) s = { gc: true, len: 1 };
          else if (k < 0.15) s = { skip: true, len: 1 };
          else {
            // Self and forward references too (the reviewer's run had to leave them out: they hung the check).
            const refs: Id[] = rnd() < 0.15 ? [...ids, [client, clock], [client, clock + 1]] : ids;
            const pickId = () => pick(refs);
            s = rnd() < 0.5 ? { origin: refs.length && rnd() < 0.9 ? pickId() : null, right: refs.length && rnd() < 0.4 ? pickId() : null, content: randContent() } : { origin: null, right: null, content: randContent() };
            if (!s.origin && !s.right) {
              s.parent = rnd() < 0.6 ? pick(["e2e", "e2e", "doc"]) : refs.length ? pickId() : "e2e";
              if (rnd() < 0.15) s.parentSub = "k";
            }
          }
          block.structs.push(s);
          ids.push([client, clock]);
          clock += lenOf(s);
        }
        blocks.push(block);
      }
      const ds: [number, [number, number][]][] = rnd() < 0.3 ? [[pick(clients), [[Math.floor(rnd() * (roomClock + 2)), 1]]]] : [];
      return encode(blocks, ds);
    };

    const totals = { cases: 0, unsafe: 0, threw: 0, accepted: 0 };
    for (const s0 of [1, 2, 3, 4]) {
      seed = s0;
      for (let i = 0; i < 3000; i++) {
        const r = makeRoom();
        let u = randUpdate(r);
        if (rnd() < 0.1) {
          u = u.slice();
          u[Math.floor(rnd() * u.length)] ^= 1 << Math.floor(rnd() * 8);
        }
        totals.cases++;
        let got: string | null;
        try {
          got = check(r, u);
        } catch {
          totals.threw++;
          continue;
        }
        if (got === null && probeCheck(r, u) !== null) totals.unsafe++;
        if (got === null) {
          totals.accepted++;
          const { relay, closed, send } = await relayOf(r);
          await send(u);
          if (closed.length === 0) {
            expect(relay.doc.store.pendingStructs).toBeNull();
            expect(relay.doc.getArray("e2e").toArray().every(isEnvelope)).toBe(true);
          }
          expect(relay.size).toBe(Y.encodeStateAsUpdate(relay.doc).byteLength);
        }
        r.destroy();
      }
    }
    console.log(`crafted updates: ${JSON.stringify(totals)}`);
    expect(totals).toMatchObject({ cases: 12_000, unsafe: 0, threw: 0 });
    expect(totals.accepted).toBeGreaterThan(100);
  });
});
