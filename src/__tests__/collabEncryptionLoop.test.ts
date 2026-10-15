/**
 * End-to-end encrypted collab transport (`src/collab/e2e.ts`).
 *
 * Each peer has a local-only plaintext Y.Doc and a transport Y.Doc. A fake
 * in-memory "provider" relays transport-doc updates between peers exactly
 * like y-webrtc / y-websocket would — it is the only thing that crosses the
 * "wire", so anything it carries is what a relay or eavesdropper would see.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { wireE2E, E2E_ARRAY_NAME, type E2EChannel } from "../collab/e2e";
import * as encryption from "../collab/encryption";

const ROOM = "lumen-calm-river-42";
const PASSWORD = "correct horse battery staple";

interface Peer {
  plain: Y.Doc;
  transport: Y.Doc;
  channel: E2EChannel;
  errors: string[];
}

/** In-memory relay: everything that crosses it is recorded as "wire" bytes. */
class FakeProvider {
  readonly wire: Uint8Array[] = [];
  private readonly docs: Y.Doc[] = [];

  connect(doc: Y.Doc): void {
    // Initial sync, both directions (like y-protocols sync step 1/2).
    for (const other of this.docs) {
      const toNew = Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc));
      const toOld = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other));
      this.wire.push(toNew, toOld);
      Y.applyUpdate(doc, toNew, this);
      Y.applyUpdate(other, toOld, this);
    }
    this.docs.push(doc);
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      this.wire.push(update);
      for (const other of this.docs) {
        if (other !== doc) Y.applyUpdate(other, update, this);
      }
    });
  }
}

function makePeer(
  provider: FakeProvider | null,
  password = PASSWORD,
  compactThreshold?: number,
): Peer {
  const plain = new Y.Doc();
  const transport = new Y.Doc();
  const errors: string[] = [];
  const channel = wireE2E(plain, transport, {
    password,
    room: ROOM,
    compactThreshold,
    onDecryptError: (r) => errors.push(r),
  });
  provider?.connect(transport);
  return { plain, transport, channel, errors };
}

async function settle(...peers: Peer[]): Promise<void> {
  // Two rounds: an encrypt on one peer produces a decrypt job on another.
  for (let i = 0; i < 3; i++) {
    await Promise.all(peers.map((p) => p.channel.whenIdle()));
  }
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const text = (p: Peer) => p.plain.getText("lumen").toString();

describe("collab E2E transport", () => {
  beforeEach(() => {
    encryption.resetCollabKey();
    vi.restoreAllMocks();
  });

  it("(1) edits on A appear on B with the correct password", async () => {
    const relay = new FakeProvider();
    const a = makePeer(relay);
    const b = makePeer(relay);

    a.plain.getText("lumen").insert(0, "Hello from A");
    await settle(a, b);
    expect(text(b)).toBe("Hello from A");

    b.plain.getText("lumen").insert(text(b).length, " — and B");
    await settle(a, b);
    expect(text(a)).toBe("Hello from A — and B");
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });

  it("(2) neither the transport doc nor anything on the wire contains plaintext", async () => {
    const relay = new FakeProvider();
    const a = makePeer(relay);
    const b = makePeer(relay);
    const secret = "TOP-SECRET merger plans for Q3";
    a.plain.getText("lumen").insert(0, secret);
    a.plain.getMap("comments").set("c1", { body: "confidential-comment-body" });
    await settle(a, b);
    expect(text(b)).toBe(secret);

    const enc = new TextEncoder();
    const needles = [secret, "TOP-SECRET", "confidential-comment-body", "lumen"].map((s) =>
      enc.encode(s),
    );
    const transportState = Y.encodeStateAsUpdate(a.transport);
    for (const n of needles) {
      expect(containsBytes(transportState, n)).toBe(false);
      for (const msg of relay.wire) expect(containsBytes(msg, n)).toBe(false);
    }
    // The transport doc only exposes the envelope array.
    expect([...a.transport.share.keys()]).toEqual([E2E_ARRAY_NAME]);
  });

  it("(3) wrong password on B: nothing applied, error raised once", async () => {
    const relay = new FakeProvider();
    const a = makePeer(relay);
    const b = makePeer(relay, "not the password");
    let bUpdates = 0;
    b.plain.on("update", () => bUpdates++);

    a.plain.getText("lumen").insert(0, "private");
    await settle(a, b);
    a.plain.getText("lumen").insert(0, "more ");
    await settle(a, b);

    expect(text(b)).toBe("");
    expect(b.plain.store.clients.size).toBe(0);
    expect(bUpdates).toBe(0);
    expect(b.errors).toEqual(["decrypt-failed"]);
  });

  it("(4) a late joiner decrypts the full history", async () => {
    const relay = new FakeProvider();
    const a = makePeer(relay);
    const b = makePeer(relay);
    a.plain.getText("lumen").insert(0, "line one\n");
    await settle(a, b);
    b.plain.getText("lumen").insert(text(b).length, "line two\n");
    await settle(a, b);
    a.plain.getText("lumen").delete(0, 5); // "line "
    await settle(a, b);

    const c = makePeer(relay);
    await settle(a, b, c);
    expect(text(c)).toBe(text(a));
    expect(text(c)).toBe("one\nline two\n");
    expect(c.errors).toEqual([]);
  });

  it("(4b) late joiner can start from a server that only holds ciphertext", async () => {
    // Simulates y-websocket persistence: the "server" is a bare transport doc.
    const relay = new FakeProvider();
    const server = new Y.Doc();
    relay.connect(server);
    const a = makePeer(relay);
    a.plain.getText("lumen").insert(0, "persisted");
    await settle(a);
    a.channel.destroy(); // A leaves

    const c = makePeer(relay);
    await settle(c);
    expect(text(c)).toBe("persisted");
  });

  it("(5) no update loop: one encrypt per local edit batch, none for remote applies", async () => {
    const relay = new FakeProvider();
    const a = makePeer(relay);
    const b = makePeer(relay);
    await settle(a, b);
    const encSpy = vi.spyOn(encryption, "encryptOp");

    for (let i = 0; i < 5; i++) {
      a.plain.getText("lumen").insert(0, `edit ${i} `);
      await settle(a, b);
    }
    expect(text(b)).toBe(text(a));
    // Exactly one encrypt per local edit; B decrypting + applying never
    // triggers a re-encrypt, and A never re-encrypts its own envelopes.
    expect(encSpy).toHaveBeenCalledTimes(5);
    const envelopes = a.transport.getArray(E2E_ARRAY_NAME).length;
    await settle(a, b);
    expect(a.transport.getArray(E2E_ARRAY_NAME).length).toBe(envelopes);
    expect(encSpy).toHaveBeenCalledTimes(5);
  });

  it("batches synchronous edits into a single envelope", async () => {
    const a = makePeer(null);
    const encSpy = vi.spyOn(encryption, "encryptOp");
    const t = a.plain.getText("lumen");
    t.insert(0, "a");
    t.insert(1, "b");
    t.insert(2, "c");
    await settle(a);
    expect(encSpy).toHaveBeenCalledTimes(1);
    expect(a.channel.envelopeCount()).toBe(1);
  });

  it("compacts into a snapshot envelope past the threshold; late joiner still converges", async () => {
    const relay = new FakeProvider();
    const a = makePeer(relay, PASSWORD, 4);
    const b = makePeer(relay, PASSWORD, 4);
    for (let i = 0; i < 6; i++) {
      a.plain.getText("lumen").insert(text(a).length, `${i}`);
      await settle(a, b);
    }
    expect(a.channel.envelopeCount()).toBeLessThanOrEqual(4);
    const snapshots = a.transport
      .getArray<{ s?: number }>(E2E_ARRAY_NAME)
      .toArray()
      .filter((e) => e.s === 1);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);

    const c = makePeer(relay, PASSWORD, 4);
    await settle(a, b, c);
    expect(text(b)).toBe("012345");
    expect(text(c)).toBe("012345");
    expect(c.errors).toEqual([]);
  });

  it("rejects envelopes whose snapshot flag was flipped by a relay (AAD binding)", async () => {
    const a = makePeer(null);
    a.plain.getText("lumen").insert(0, "x");
    await settle(a);
    const env = a.transport.getArray<Record<string, unknown>>(E2E_ARRAY_NAME).get(0);

    const b = makePeer(null);
    b.transport.getArray(E2E_ARRAY_NAME).push([{ ...env, s: 1 }]);
    await settle(b);
    expect(text(b)).toBe("");
    expect(b.errors).toEqual(["decrypt-failed"]);
  });

  it("uses a room-scoped key: same password, different room → cannot decrypt", async () => {
    const a = makePeer(null);
    a.plain.getText("lumen").insert(0, "room-bound");
    await settle(a);

    const otherPlain = new Y.Doc();
    const otherTransport = new Y.Doc();
    const errors: string[] = [];
    const ch = wireE2E(otherPlain, otherTransport, {
      password: PASSWORD,
      room: "some-other-room",
      onDecryptError: (r) => errors.push(r),
    });
    Y.applyUpdate(otherTransport, Y.encodeStateAsUpdate(a.transport));
    await ch.whenIdle();
    expect(otherPlain.getText("lumen").toString()).toBe("");
    expect(errors).toEqual(["decrypt-failed"]);
  });
});
