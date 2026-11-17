/**
 * A havruta session (plan W12.H1, W12.H3): the study room's document,
 * end-to-end encrypted on the way, offline first, and deleted at the end.
 *
 *  - Encryption: the same split as a shared note (src/collab/yjs.ts). The
 *    plaintext document (./room.ts) is never attached to a provider; a
 *    transport document holding only `src/collab/e2e.ts` envelopes is, and
 *    presence goes through `e2eAwareness` the same way. The relay sees
 *    ciphertext, which `checkE2eeUpdate` (sync-server/collab/relay.mjs)
 *    enforces on its side too.
 *  - Offline (W12.H3): the plaintext state is kept on the device
 *    (`persist`, IndexedDB in the app) after every change and loaded first,
 *    so a session that starts with no network works, and its notes merge
 *    with the partner's when either reconnects (Yjs: no note is lost).
 *  - "End session" (W12.H3): marks the room ended (the partner's side saves
 *    its note and leaves too), waits until the last change is sealed and
 *    sent, deletes the room on the relay (./relayAdmin.ts), forgets the
 *    local state and leaves. The session note stays in each vault.
 */
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { wireE2E, type E2EChannel, type E2EErrorReason } from "../collab/e2e";
import { wireE2EAwareness, type AwarenessLike, type E2EAwarenessBridge } from "../collab/e2eAwareness";
import { initRoom, markEnded, roomEnded, type HavrutaPresence, type HavrutaRef } from "./room";

export interface HavrutaPersist {
  load(room: string): Promise<Uint8Array | null>;
  save(room: string, state: Uint8Array): Promise<void>;
  clear(room: string): Promise<void>;
}

/** The provider for the transport document (in the app: collab/persistentProvider, the relay). */
export interface HavrutaLink {
  destroy(): void;
}
export type HavrutaConnect = (transport: Y.Doc, awareness: Awareness) => Promise<HavrutaLink>;

export interface HavrutaOptions {
  /** The plain room name (`havruta-…`, room.ts newHavrutaRoomName). */
  room: string;
  password: string;
  /** The reference, when this side opens the room. */
  ref?: HavrutaRef;
  connect: HavrutaConnect;
  persist?: HavrutaPersist;
  /** Delete the room on the relay ("end session"); in the app ./relayAdmin.ts deleteRoomOnRelay. */
  deleteOnRelay?: () => Promise<unknown>;
  /** The partner ended the session. */
  onEnded?: () => void;
  onDecryptError?: (reason: E2EErrorReason) => void;
  /** How long changes wait before they are written to `persist` (ms). */
  persistDelayMs?: number;
}

export interface HavrutaSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: string;
  /** Online: the relay link is up. */
  readonly online: boolean;
  setPresence(p: HavrutaPresence): void;
  /** Try the relay again (after starting offline, or a dropped link). */
  reconnect(): Promise<boolean>;
  /** Every change sealed (and handed to the provider) and written to `persist`. */
  whenIdle(): Promise<void>;
  /** "End session": the room is deleted on the relay and here. */
  end(): Promise<void>;
  /** Leave without deleting (the room stays until it expires). */
  leave(): Promise<void>;
}

export async function openHavruta(opts: HavrutaOptions): Promise<HavrutaSession> {
  const doc = new Y.Doc();
  const saved = await opts.persist?.load(opts.room).catch(() => null);
  if (saved) Y.applyUpdate(doc, saved, "havruta-persist");
  if (opts.ref) initRoom(doc, opts.ref);

  const transport = new Y.Doc();
  transport.clientID = doc.clientID;
  const e2e: E2EChannel = wireE2E(doc, transport, { password: opts.password, room: opts.room, onDecryptError: opts.onDecryptError });
  const awareness = new Awareness(doc);
  const transportAwareness = new Awareness(transport);
  const bridge: E2EAwarenessBridge = wireE2EAwareness(awareness as unknown as AwarenessLike, transportAwareness as unknown as AwarenessLike, { password: opts.password, room: opts.room, onDecryptError: opts.onDecryptError });

  // Offline first: every change is kept on the device.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persisting: Promise<void> = Promise.resolve();
  let closed = false;
  const writeNow = () => {
    persistTimer = null;
    if (closed || !opts.persist) return;
    const state = Y.encodeStateAsUpdate(doc);
    persisting = persisting.then(() => opts.persist!.save(opts.room, state)).catch(() => undefined);
  };
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === "havruta-persist" || !opts.persist || closed) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(writeNow, opts.persistDelayMs ?? 300);
  };
  doc.on("update", onUpdate);

  let endedSeen = roomEnded(doc);
  const meta = doc.getMap("meta");
  const onMeta = () => {
    if (!endedSeen && roomEnded(doc)) {
      endedSeen = true;
      opts.onEnded?.();
    }
  };
  meta.observe(onMeta);

  let link: HavrutaLink | null = null;
  const connect = async () => {
    if (link || closed) return !!link;
    try {
      link = await opts.connect(transport, transportAwareness);
      return true;
    } catch {
      link = null; // offline: keep working locally, `reconnect` tries again
      return false;
    }
  };
  await connect();

  const idle = async () => {
    await e2e.whenIdle();
    await bridge.whenIdle();
    if (persistTimer) {
      clearTimeout(persistTimer);
      writeNow();
    }
    await persisting;
  };

  const close = async (forget: boolean) => {
    if (closed) return;
    await idle();
    closed = true;
    doc.off("update", onUpdate);
    meta.unobserve(onMeta);
    awareness.setLocalState(null);
    await bridge.whenIdle();
    link?.destroy();
    link = null;
    bridge.destroy();
    e2e.destroy();
    transportAwareness.destroy();
    awareness.destroy();
    if (forget) await opts.persist?.clear(opts.room).catch(() => undefined);
  };

  return {
    doc,
    awareness,
    room: opts.room,
    get online() {
      return !!link;
    },
    setPresence(p) {
      awareness.setLocalState({ ...p });
    },
    reconnect: connect,
    whenIdle: idle,
    async end() {
      markEnded(doc);
      await idle();
      // Give the provider a moment to deliver the last envelope, so the partner sees "ended".
      if (link) await new Promise((r) => setTimeout(r, 150));
      link?.destroy();
      link = null;
      await opts.deleteOnRelay?.();
      await close(true);
    },
    leave: () => close(false),
  };
}
