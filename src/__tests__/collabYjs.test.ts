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
    destroy = vi.fn(() => {
      return;
    });
    constructor() {
      WebsocketProvider.instances.push(this);
    }
  }
  return { WebsocketProvider };
});
vi.mock("y-webrtc", () => ({
  WebrtcProvider: class {
    awareness = { getStates: () => new Map(), setLocalStateField: vi.fn() };
    destroy = vi.fn();
    on = vi.fn();
  },
}));
vi.mock("yjs", async () => {
  const actual = await vi.importActual<typeof import("yjs")>("yjs");
  return actual;
});
vi.mock("../collab/encryption", () => ({
  encryptOp: (op: unknown) => op,
  decryptOp: (op: unknown) => op,
}));
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
});
