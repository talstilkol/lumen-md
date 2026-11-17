/**
 * Plan W13.S6 — encrypted presence across a shared vault: who has which note
 * open, with the device name the user chose; the relay sees sealed bytes
 * only; a peer not heard from for 30 seconds disappears; off by default and
 * in airplane mode (nothing is sent at all).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AwarenessLike } from "../collab/e2eAwareness";
import { E2E_AWARENESS_FIELD } from "../collab/e2eAwareness";
import { PRESENCE_HEARTBEAT_MS, PRESENCE_TTL_MS, cleanDeviceName, presenceEnabled, presenceKeys, setPresenceEnabled, startVaultPresence, type VaultPresence } from "../collab/vaultPresence";
import { devicesOn, presencePeers, setPresence } from "../collab/presenceStore";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, swallowed: vi.fn() }));

type State = Record<string, unknown>;
type Changes = { added: number[]; updated: number[]; removed: number[] };
type Listener = (c: Changes, origin: unknown) => void;

/** Enough of y-protocols' Awareness for the bridge: states, meta, change/update events. */
class MiniAwareness implements AwarenessLike {
  states = new Map<number, State>();
  meta = new Map<number, { clock: number; lastUpdated: number }>();
  private ls = { change: new Set<Listener>(), update: new Set<Listener>() };
  constructor(public clientID: number) {}
  getLocalState() {
    return this.states.get(this.clientID) ?? null;
  }
  setLocalState(state: State | null) {
    const had = this.states.has(this.clientID);
    const clock = (this.meta.get(this.clientID)?.clock ?? 0) + 1;
    if (state === null) this.states.delete(this.clientID);
    else this.states.set(this.clientID, state);
    this.meta.set(this.clientID, { clock, lastUpdated: Date.now() });
    const c: Changes = state === null ? { added: [], updated: [], removed: had ? [this.clientID] : [] } : had ? { added: [], updated: [this.clientID], removed: [] } : { added: [this.clientID], updated: [], removed: [] };
    this.emit("change", [c, "local"]);
    this.emit("update", [c, "local"]);
  }
  getStates() {
    return this.states;
  }
  on(e: "change" | "update", fn: Listener) {
    this.ls[e].add(fn);
  }
  off(e: "change" | "update", fn: Listener) {
    this.ls[e].delete(fn);
  }
  emit(e: "change" | "update", args: [Changes, unknown]) {
    for (const fn of [...this.ls[e]]) fn(...args);
  }
  /** What the relay applies: another client's state, as the wire carries it. */
  applyRemote(id: number, state: State | null) {
    const had = this.states.has(id);
    if (state === null) this.states.delete(id);
    else this.states.set(id, state);
    this.meta.set(id, { clock: (this.meta.get(id)?.clock ?? 0) + 1, lastUpdated: Date.now() });
    const c: Changes = state === null ? { added: [], updated: [], removed: had ? [id] : [] } : had ? { added: [], updated: [id], removed: [] } : { added: [id], updated: [], removed: [] };
    this.emit("change", [c, "relay"]);
    this.emit("update", [c, "relay"]);
  }
}

interface Device {
  plain: MiniAwareness;
  transport: MiniAwareness;
  p: VaultPresence | null;
}

let clock = 1_000_000;
const timers: Array<() => void> = [];
const live: VaultPresence[] = [];

/** A relay that forwards transport states between devices and keeps every byte it saw. */
function relay(...ds: Device[]): { wire: string[] } {
  const wire: string[] = [];
  for (const from of ds)
    from.transport.on("update", (c, origin) => {
      if (origin === "relay") return;
      for (const id of [...c.added, ...c.updated, ...c.removed]) {
        const st = from.transport.getStates().get(id) ?? null;
        wire.push(JSON.stringify({ id, st }));
        for (const to of ds) if (to !== from) to.transport.applyRemote(id, st);
      }
    });
  return { wire };
}

async function device(id: number, secret: Uint8Array, name: string, opts: { enabled?: boolean; airplane?: boolean; store?: boolean } = {}): Promise<Device> {
  const { room, password } = await presenceKeys(secret, "vault-1");
  const plain = new MiniAwareness(id);
  const transport = new MiniAwareness(id);
  const p = startVaultPresence({
    plain,
    transport,
    room,
    password,
    device: name,
    now: () => clock,
    enabled: () => opts.enabled ?? true,
    airplane: () => opts.airplane ?? false,
    // One device per app: only the device under test writes the shared store.
    ...(opts.store === false ? { publish: () => undefined } : {}),
    setInterval: (fn) => (timers.push(fn), timers.length - 1),
    clearInterval: () => undefined,
  });
  if (p) live.push(p);
  return { plain, transport, p };
}

const settle = async (...ds: Device[]) => {
  for (let i = 0; i < 3; i++) for (const d of ds) await d.p?.whenIdle();
};
const SECRET = new Uint8Array(32).fill(7);

beforeEach(() => {
  clock = 1_000_000;
  timers.length = 0;
  localStorage.clear();
  setPresence([]);
});
afterEach(() => {
  for (const p of live.splice(0)) p.destroy();
});

describe("vault presence", () => {
  it("each device sees which note the other has open, under the name it chose; the relay sees only sealed states", async () => {
    const a = await device(1, SECRET, "הטלפון של דנה", { store: false });
    const b = await device(2, SECRET, "Bob's laptop", { store: false });
    const { wire } = relay(a, b);
    a.p!.setNote("משפחה/קניות.md");
    b.p!.setNote("school/homework.md");
    await vi.waitFor(async () => {
      await settle(a, b);
      expect(b.p!.peers().map((x) => [x.device, x.note])).toEqual([["הטלפון של דנה", "משפחה/קניות.md"]]);
      expect(a.p!.peers().map((x) => [x.device, x.note])).toEqual([["Bob's laptop", "school/homework.md"]]);
    });
    // The tree and the tabs read the store (A's view: Bob on his homework).
    a.p!.prune();
    expect(devicesOn("school/homework.md")).toEqual([]);
    const viewer = await device(3, SECRET, "viewer");
    relay(a, b, viewer);
    a.p!.setNote("משפחה/קניות.md");
    b.p!.setNote("school/homework.md");
    await vi.waitFor(async () => {
      await settle(a, b, viewer);
      expect(devicesOn("school/homework.md")).toEqual(["Bob's laptop"]);
      expect(devicesOn("משפחה/קניות.md")).toEqual(["הטלפון של דנה"]);
    });
    const all = wire.join("\n");
    expect(wire.length).toBeGreaterThan(0);
    for (const secret of ["דנה", "Bob", "קניות", "homework", "presence", "note", "device"]) expect(all).not.toContain(secret);
    for (const st of b.transport.getStates().values()) expect(Object.keys(st)).toEqual([E2E_AWARENESS_FIELD]);
  });

  it("a device not heard from for 30 seconds is gone; a heartbeat every 15 seconds keeps it", async () => {
    const a = await device(1, SECRET, "A");
    const b = await device(2, SECRET, "B");
    relay(a, b);
    a.p!.setNote("x.md");
    await vi.waitFor(async () => {
      await settle(a, b);
      expect(b.p!.peers()).toHaveLength(1);
    });
    // Heartbeats keep A alive past the TTL.
    for (let t = 0; t < 4; t++) {
      clock += PRESENCE_HEARTBEAT_MS;
      timers[0]!(); // A's heartbeat
      await settle(a, b);
    }
    b.p!.prune();
    expect(b.p!.peers()).toHaveLength(1);
    // A's laptop closes: no departure message, no more heartbeats.
    clock += PRESENCE_TTL_MS + 1;
    b.p!.prune();
    expect(b.p!.peers()).toEqual([]);
    expect(presencePeers()).toEqual([]);
  });

  it("a clean departure removes the device at once", async () => {
    const a = await device(1, SECRET, "A");
    const b = await device(2, SECRET, "B");
    relay(a, b);
    a.p!.setNote("x.md");
    await vi.waitFor(async () => {
      await settle(a, b);
      expect(b.p!.peers()).toHaveLength(1);
    });
    a.p!.destroy();
    await vi.waitFor(async () => {
      await settle(b);
      expect(b.p!.peers()).toEqual([]);
    });
  });

  it("another vault's key sees nothing", async () => {
    const a = await device(1, SECRET, "A");
    const b = await device(2, new Uint8Array(32).fill(8), "B");
    relay(a, b);
    a.p!.setNote("x.md");
    await settle(a, b);
    await new Promise((r) => setTimeout(r, 20));
    await settle(a, b);
    expect(b.p!.peers()).toEqual([]);
  });

  it("off by default, off in airplane mode, off without a device name: nothing is sent at all", async () => {
    expect(presenceEnabled()).toBe(false);
    const { room, password } = await presenceKeys(SECRET, "vault-1");
    const plain = new MiniAwareness(9);
    const transport = new MiniAwareness(9);
    const sent: unknown[] = [];
    transport.on("update", (c) => sent.push(c));
    expect(startVaultPresence({ plain, transport, room, password, device: "A" })).toBeNull();
    setPresenceEnabled(true);
    expect(presenceEnabled()).toBe(true);
    expect(startVaultPresence({ plain, transport, room, password, device: "A", airplane: () => true })).toBeNull();
    expect(startVaultPresence({ plain, transport, room, password, device: "  ‮ " })).toBeNull();
    expect(sent).toEqual([]);
    expect(plain.getLocalState()).toBeNull();
  });

  it("airplane mode switched on mid-session stops it at the next heartbeat", async () => {
    let air = false;
    const { room, password } = await presenceKeys(SECRET, "vault-1");
    const plain = new MiniAwareness(3);
    const p = startVaultPresence({ plain, room, password, device: "A", enabled: () => true, airplane: () => air, now: () => clock, setInterval: (fn) => (timers.push(fn), 0), clearInterval: () => undefined })!;
    p.setNote("a.md");
    expect(plain.getLocalState()).not.toBeNull();
    air = true;
    timers[0]!();
    expect(plain.getLocalState()).toBeNull();
  });

  it("the room id and password come from the vault secret, differ per vault, and reveal neither", async () => {
    const k1 = await presenceKeys(SECRET, "vault-1");
    const k2 = await presenceKeys(SECRET, "vault-2");
    const k3 = await presenceKeys(new Uint8Array(32).fill(1), "vault-1");
    expect(k1.room).toMatch(/^p-[A-Za-z0-9_-]{22}$/);
    expect(new Set([k1.room, k2.room, k3.room]).size).toBe(3);
    expect(k1.password).not.toContain("vault-1");
    expect(k1.room).not.toContain(k1.password.slice(0, 8));
  });

  it("device names are one clean line: no control or bidi-override characters, at most 40 characters", () => {
    expect(cleanDeviceName("  דנה\n‮evil‬  ")).toBe("דנה evil");
    expect([...cleanDeviceName("א".repeat(60))]).toHaveLength(40);
  });
});
