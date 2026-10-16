/**
 * Unit tests for helpers in src/collab/yjs.ts:
 *   makeRoomName, readRoomFromHash, setRoomInHash, snapshotPeers.
 *
 * connectCollab lifecycle behavior is also tested with transport-safe mocks.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Mock heavy collab deps that would try to open WebSocket connections
vi.mock("y-websocket", () => {
  const instances: unknown[] = [];
  class WebsocketProvider {
    static instances: unknown[] = instances;
    /** Set by a test to model y-websocket's sync handshake; plain stubs settle at once. */
    static withSync = false;
    destroy = vi.fn(() => {
      return;
    });
    synced = false;
    syncListeners = new Set<(s: boolean) => void>();
    on?: (e: string, fn: (s: boolean) => void) => void;
    off?: (e: string, fn: (s: boolean) => void) => void;
    constructor() {
      WebsocketProvider.instances.push(this);
      if (WebsocketProvider.withSync) {
        this.on = (_e, fn) => this.syncListeners.add(fn);
        this.off = (_e, fn) => this.syncListeners.delete(fn);
      }
    }
    emitSync(v: boolean) {
      this.synced = v;
      this.syncListeners.forEach((fn) => fn(v));
    }
  }
  return { WebsocketProvider };
});
vi.mock("y-webrtc", () => ({
  // Minimal stand-in: an event emitter with controllable awareness peers and
  // WebRTC connections so tests can drive the `synced` seeding logic.
  WebrtcProvider: class {
    static lastDoc: unknown = null;
    constructor(_room: string, doc: unknown) {
      (this.constructor as unknown as { lastDoc: unknown }).lastDoc = doc;
    }
    listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    awarenessStates = new Map<number, unknown>([[1, {}]]);
    room: { webrtcConns: Map<string, unknown> } = { webrtcConns: new Map() };
    awareness = {
      getStates: () => this.awarenessStates,
      setLocalStateField: vi.fn(),
    };
    destroy = vi.fn();
    on(name: string, fn: (...args: unknown[]) => void) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name)!.add(fn);
    }
    off(name: string, fn: (...args: unknown[]) => void) {
      this.listeners.get(name)?.delete(fn);
    }
    emit(name: string, args: unknown[]) {
      this.listeners.get(name)?.forEach((fn) => fn(...args));
    }
  },
}));
vi.mock("yjs", async () => {
  const actual = await vi.importActual<typeof import("yjs")>("yjs");
  return actual;
});
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/cryptoRandom", () => ({
  randomChoice: (arr: unknown[]) => arr[0],
  randomInt: () => 42,
  randomId: () => "test-id",
}));

afterEach(() => {
  localStorage.removeItem("lumen.collab.ws");
});

describe("makeRoomName", () => {
  it("returns a non-empty string", async () => {
    const { makeRoomName } = await import("../collab/yjs");
    const name = makeRoomName();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("contains a hyphen separator between adjective and noun", async () => {
    const { makeRoomName } = await import("../collab/yjs");
    const name = makeRoomName();
    expect(name).toContain("-");
  });

  it("always generates a URL-safe string (no spaces or special chars)", async () => {
    const { makeRoomName } = await import("../collab/yjs");
    for (let i = 0; i < 20; i++) {
      const name = makeRoomName();
      expect(name).toMatch(/^[\w-]+$/);
    }
  });

  it("ends with a numeric suffix", async () => {
    const { makeRoomName } = await import("../collab/yjs");
    const name = makeRoomName();
    // format is "adj-noun-NNN"
    const parts = name.split("-");
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const suffix = parts[parts.length - 1];
    expect(Number.isInteger(Number(suffix))).toBe(true);
  });
});

describe("readRoomFromHash", () => {
  const origLocation = globalThis.location;

  afterEach(() => {
    Object.defineProperty(globalThis, "location", {
      value: origLocation,
      writable: true,
    });
  });

  it("returns null when hash is empty", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { hash: "" },
      writable: true,
    });
    const { readRoomFromHash } = await import("../collab/yjs");
    expect(readRoomFromHash()).toBeNull();
  });

  it("returns the room name when #room= is in hash", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { hash: "#room=calm-river-42" },
      writable: true,
    });
    const { readRoomFromHash } = await import("../collab/yjs");
    expect(readRoomFromHash()).toBe("calm-river-42");
  });

  it("returns room name when &room= appears in hash params", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { hash: "#other=foo&room=bright-comet-7" },
      writable: true,
    });
    const { readRoomFromHash } = await import("../collab/yjs");
    expect(readRoomFromHash()).toBe("bright-comet-7");
  });

  it("returns null when hash does not contain room param", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { hash: "#theme=dark" },
      writable: true,
    });
    const { readRoomFromHash } = await import("../collab/yjs");
    expect(readRoomFromHash()).toBeNull();
  });
});

describe("snapshotPeers", () => {
  it("returns empty array when awareness has no user states", async () => {
    const { snapshotPeers } = await import("../collab/yjs");
    const Y = await vi.importActual<typeof import("yjs")>("yjs");
    const doc = new (Y as any).Doc();
    const session = {
      doc,
      awareness: {
        getStates: () => new Map([[doc.clientID, {}]]), // no .user field
      },
    } as any;
    const peers = snapshotPeers(session);
    expect(peers).toEqual([]);
  });

  it("returns peers with user info from awareness states", async () => {
    const { snapshotPeers } = await import("../collab/yjs");
    const Y = await vi.importActual<typeof import("yjs")>("yjs");
    const doc = new (Y as any).Doc();
    const selfUser = { name: "Alice", color: "hsl(200 70% 55%)", colorLight: "hsl(200 70% 85%)" };
    const peerUser = { name: "Bob", color: "hsl(100 70% 55%)", colorLight: "hsl(100 70% 85%)" };
    const states = new Map([
      [doc.clientID, { user: selfUser }],
      [999, { user: peerUser }],
    ]);
    const session = {
      doc,
      awareness: { getStates: () => states },
    } as any;
    const peers = snapshotPeers(session);
    expect(peers.length).toBe(2);
    const self = peers.find((p) => p.isSelf);
    expect(self?.user.name).toBe("Alice");
    const other = peers.find((p) => !p.isSelf);
    expect(other?.user.name).toBe("Bob");
  });

  it("puts self first in the returned list", async () => {
    const { snapshotPeers } = await import("../collab/yjs");
    const Y = await vi.importActual<typeof import("yjs")>("yjs");
    const doc = new (Y as any).Doc();
    const selfUser = { name: "Self", color: "blue", colorLight: "lightblue" };
    const peerUser = { name: "Peer", color: "red", colorLight: "pink" };
    const states = new Map([
      [999, { user: peerUser }],   // lower client ID, added first
      [doc.clientID, { user: selfUser }],
    ]);
    const session = {
      doc,
      awareness: { getStates: () => states },
    } as any;
    const peers = snapshotPeers(session);
    expect(peers[0].isSelf).toBe(true);
    expect(peers[0].user.name).toBe("Self");
  });
});

describe("connectCollab lifecycle", () => {
  it("does not seed content if the session is destroyed before timeout", async () => {
    const mod = await import("../collab/yjs");
    vi.useFakeTimers();
    try {
      const session = mod.connectCollab("lumen-seed-room", "seed");
      session.destroy();
      vi.advanceTimersByTime(500);
      expect(session.ytext.toString()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not attach a saved persistent server when the plan doesn't include it", async () => {
    localStorage.setItem("lumen.collab.ws", "ws://localhost:4444");
    const { useEntitlement, __setEntitlementEndpointForTesting } = await import("../billing/useEntitlement");
    const { FREE_CAPS } = await import("../billing/types");
    __setEntitlementEndpointForTesting("https://billing.lumen.test/entitlements");
    useEntitlement.setState({ capabilities: FREE_CAPS, entitlement: null, loading: false });
    try {
      const mod = await import("../collab/yjs");
      const moduleMock = await import(/* @vite-ignore */ "y-websocket");
      const before = (moduleMock.WebsocketProvider as unknown as { instances: unknown[] }).instances.length;
      const session = mod.connectCollab("lumen-free-room", "");
      await new Promise((r) => setTimeout(r, 20));
      expect((moduleMock.WebsocketProvider as unknown as { instances: unknown[] }).instances.length).toBe(before);
      session.destroy();
    } finally {
      __setEntitlementEndpointForTesting(null);
    }
  });

  it("does not retain websocket provider when destroy happens before attach completes", async () => {
    localStorage.setItem("lumen.collab.ws", "ws://localhost:4444");
    const mod = await import("../collab/yjs");
    const moduleMock = await import(/* @vite-ignore */ "y-websocket");
    const instancesBefore = (moduleMock.WebsocketProvider as unknown as { instances: unknown[] }).instances.length;

    const session = mod.connectCollab("lumen-seed-room", "");
    session.destroy();
    // The attach path is `await import('y-websocket')` → `new
    // WebsocketProvider(...)` → the consumer's `.then(p => …)`. Microtask
    // counts differ between vitest module runners, so poll instead of
    // flushing a fixed number of ticks.
    await vi.waitFor(() => {
      expect(
        (moduleMock.WebsocketProvider as unknown as { instances: unknown[] }).instances.length,
      ).toBe(instancesBefore + 1);
    });
    expect(session.websocketProvider).toBeNull();

    for (const instance of (moduleMock.WebsocketProvider as unknown as { instances: unknown[] }).instances) {
      const destroy = (instance as { destroy: () => void }).destroy;
      if (typeof destroy === "function") {
        expect(destroy).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("plain rooms sync the editor doc directly", async () => {
    const mod = await import("../collab/yjs");
    const { WebrtcProvider } = await import("y-webrtc");
    const session = mod.connectCollab("lumen-plain-room", "", { password: null });
    expect(session.encrypted).toBe(false);
    expect(session.transportDoc).toBeNull();
    expect((WebrtcProvider as unknown as { lastDoc: unknown }).lastDoc).toBe(session.doc);
    session.destroy();
  });

  it("password rooms attach providers to the ciphertext transport doc only", async () => {
    const mod = await import("../collab/yjs");
    const { WebrtcProvider } = await import("y-webrtc");
    const session = mod.connectCollab("lumen-secret-room", "", { password: "pw-123456" });
    expect(session.encrypted).toBe(true);
    expect(session.transportDoc).not.toBeNull();
    const attached = (WebrtcProvider as unknown as { lastDoc: unknown }).lastDoc;
    expect(attached).toBe(session.transportDoc);
    expect(attached).not.toBe(session.doc);
    // Awareness self-detection relies on matching client ids.
    expect(session.transportDoc!.clientID).toBe(session.doc.clientID);
    session.destroy();
  });
});

type MockProvider = {
  emit: (name: string, args: unknown[]) => void;
  listeners: Map<string, Set<unknown>>;
  awarenessStates: Map<number, unknown>;
  room: { webrtcConns: Map<string, unknown> };
};

describe("connectCollab join-time seeding", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds a new room synchronously", async () => {
    const mod = await import("../collab/yjs");
    const session = mod.connectCollab("lumen-new", "hello", { isNewRoom: true });
    expect(session.ytext.toString()).toBe("hello");
    session.destroy();
  });

  it("does not seed before synced or the fallback timeout", async () => {
    vi.useFakeTimers();
    const mod = await import("../collab/yjs");
    const session = mod.connectCollab("lumen-join", "seed");
    vi.advanceTimersByTime(mod.SEED_FALLBACK_MS - 1);
    expect(session.ytext.toString()).toBe("");
    session.destroy();
  });

  it("seeds via the fallback timer when no peers ever appear", async () => {
    vi.useFakeTimers();
    const mod = await import("../collab/yjs");
    const session = mod.connectCollab("lumen-join", "seed");
    vi.advanceTimersByTime(mod.SEED_FALLBACK_MS);
    expect(session.ytext.toString()).toBe("seed");
    // The synced listener is removed once we've decided.
    const p = session.provider as unknown as MockProvider;
    expect(p.listeners.get("synced")?.size ?? 0).toBe(0);
    session.destroy();
  });

  it("seeds on synced when still empty and alone, and cancels the fallback timer", async () => {
    vi.useFakeTimers();
    const mod = await import("../collab/yjs");
    const session = mod.connectCollab("lumen-join", "seed");
    const p = session.provider as unknown as MockProvider;
    p.emit("synced", [{ synced: true }]);
    expect(session.ytext.toString()).toBe("seed");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(mod.SEED_FALLBACK_MS * 2);
    expect(session.ytext.toString()).toBe("seed"); // not seeded twice
    session.destroy();
  });

  it("ignores synced:false", async () => {
    vi.useFakeTimers();
    const mod = await import("../collab/yjs");
    const session = mod.connectCollab("lumen-join", "seed");
    const p = session.provider as unknown as MockProvider;
    p.emit("synced", [{ synced: false }]);
    expect(session.ytext.toString()).toBe("");
    expect(vi.getTimerCount()).toBe(1);
    session.destroy();
  });

  it("does not seed when remote content arrived before synced", async () => {
    vi.useFakeTimers();
    const mod = await import("../collab/yjs");
    const session = mod.connectCollab("lumen-join", "seed");
    const p = session.provider as unknown as MockProvider;
    session.ytext.insert(0, "remote doc");
    p.emit("synced", [{ synced: true }]);
    vi.advanceTimersByTime(mod.SEED_FALLBACK_MS * 2);
    expect(session.ytext.toString()).toBe("remote doc");
    session.destroy();
  });

  it("waits for synced instead of seeding on timeout when peers are connected", async () => {
    vi.useFakeTimers();
    const mod = await import("../collab/yjs");
    const session = mod.connectCollab("lumen-join", "seed");
    const p = session.provider as unknown as MockProvider;
    p.room.webrtcConns.set("peer-1", {});
    p.awarenessStates.set(2, {});
    vi.advanceTimersByTime(mod.SEED_FALLBACK_MS);
    expect(session.ytext.toString()).toBe("");
    // Still listening for synced.
    expect(p.listeners.get("synced")?.size).toBe(1);
    // Peer delivers its (non-empty) state, then synced fires.
    session.ytext.insert(0, "peer content");
    p.emit("synced", [{ synced: true }]);
    expect(session.ytext.toString()).toBe("peer content");
    session.destroy();
  });

  it("removes the synced listener and timer on destroy", async () => {
    vi.useFakeTimers();
    const mod = await import("../collab/yjs");
    const session = mod.connectCollab("lumen-join", "seed");
    const p = session.provider as unknown as MockProvider;
    session.destroy();
    expect(p.listeners.get("synced")?.size ?? 0).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("seeding with a persistent (y-websocket) server", () => {
  afterEach(() => {
    localStorage.removeItem("lumen.collab.ws");
  });

  it("waits for the server's sync before seeding, and doesn't seed over its history", async () => {
    localStorage.setItem("lumen.collab.ws", "ws://localhost:4444");
    const ws = (await import(/* @vite-ignore */ "y-websocket")) as unknown as {
      WebsocketProvider: { withSync: boolean; instances: { emitSync(v: boolean): void }[] };
    };
    ws.WebsocketProvider.withSync = true;
    try {
      const mod = await import("../collab/yjs");
      const session = mod.connectCollab("lumen-persisted", "local draft");
      const p = session.provider as unknown as MockProvider;
      p.emit("synced", [{ synced: true }]); // WebRTC: alone, nothing from peers
      expect(session.ytext.toString()).toBe(""); // not seeded yet: server pending
      await vi.waitFor(() => expect(session.websocketProvider).not.toBeNull());
      // Server delivers the room's history, then reports synced.
      session.ytext.insert(0, "server history");
      ws.WebsocketProvider.instances.at(-1)!.emitSync(true);
      expect(session.ytext.toString()).toBe("server history"); // no merge with the local draft
      session.destroy();
    } finally {
      ws.WebsocketProvider.withSync = false;
    }
  });

  it("seeds once the server reports an empty room", async () => {
    localStorage.setItem("lumen.collab.ws", "ws://localhost:4444");
    const ws = (await import(/* @vite-ignore */ "y-websocket")) as unknown as {
      WebsocketProvider: { withSync: boolean; instances: { emitSync(v: boolean): void }[] };
    };
    ws.WebsocketProvider.withSync = true;
    try {
      const mod = await import("../collab/yjs");
      const session = mod.connectCollab("lumen-empty-persisted", "local draft");
      (session.provider as unknown as MockProvider).emit("synced", [{ synced: true }]);
      await vi.waitFor(() => expect(session.websocketProvider).not.toBeNull());
      expect(session.ytext.toString()).toBe("");
      ws.WebsocketProvider.instances.at(-1)!.emitSync(true);
      expect(session.ytext.toString()).toBe("local draft");
      session.destroy();
    } finally {
      ws.WebsocketProvider.withSync = false;
    }
  });
});
