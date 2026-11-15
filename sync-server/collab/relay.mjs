/**
 * A room of the public collab relay (plan W4.8): end-to-end encrypted
 * documents only, so the server never holds a note's text.
 *
 * Two pieces, shared by both servers:
 *
 *   checkE2eeUpdate(doc, update)   is this Yjs update, applied to the room's
 *                                  document, still nothing but encrypted
 *                                  envelopes? (src/collab/e2e.ts writes one
 *                                  `Y.Array("e2e")` of {v, iv, ct, s?}.)
 *                                  `collab-server.mjs` runs it before
 *                                  Hocuspocus applies a message when
 *                                  COLLAB_E2EE_ONLY=1; the Worker always.
 *
 *   createRelayRoom(opts)          the Hocuspocus wire protocol (v4: auth,
 *                                  sync, awareness, sync status) for one
 *                                  document, on any socket with send/close.
 *                                  The Cloudflare Durable Object in
 *                                  edge-workers/collab/ hosts one per room.
 *
 * Awareness (cursors and the random display name) is relayed between the
 * people in the room and kept in memory only; it is never stored.
 */
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { createRoomMeter } from "./roomSize.mjs";

export const E2E_ARRAY = "e2e";

/** Hocuspocus message types (packages/server/src/types.ts, v4.7.0). */
export const MessageType = { Sync: 0, Awareness: 1, Auth: 2, QueryAwareness: 3, SyncReply: 4, Stateless: 5, CLOSE: 7, SyncStatus: 8 };
const SyncStep1 = 0;
const SyncStep2 = 1;
const SyncUpdate = 2;
const AuthToken = 0;
const AuthPermissionDenied = 1;
const AuthAuthenticated = 2;

/** Close codes the provider understands (@hocuspocus/common CloseEvents). */
export const Close = {
  Forbidden: { code: 4403, reason: "Forbidden" },
  TooLarge: { code: 4413, reason: "Room too large" },
  Reset: { code: 4205, reason: "Reset Content" },
};

const isBytes = (x) => x instanceof Uint8Array;

/** Is `x` exactly one envelope of src/collab/e2e.ts: {v, iv(12), ct(≥16), s?: 1}? */
function isEnvelope(x) {
  if (!x || typeof x !== "object" || Array.isArray(x) || isBytes(x)) return false;
  for (const k of Object.keys(x)) if (k !== "v" && k !== "iv" && k !== "ct" && k !== "s") return false;
  return (
    typeof x.v === "number" &&
    Number.isInteger(x.v) &&
    isBytes(x.iv) &&
    x.iv.byteLength === 12 &&
    isBytes(x.ct) &&
    x.ct.byteLength >= 16 &&
    (x.s === undefined || x.s === 1)
  );
}

/** The struct of `structs` (sorted by clock, one client) that holds `clock`, or null. */
function structAt(structs, clock) {
  if (!structs || structs.length === 0) return null;
  const last = structs[structs.length - 1];
  if (clock < structs[0].id.clock || clock >= last.id.clock + last.length) return null;
  let lo = 0;
  let hi = structs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s = structs[mid];
    if (clock < s.id.clock) hi = mid - 1;
    else if (clock >= s.id.clock + s.length) lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * Null when `doc` with `update` applied holds only encrypted envelopes in
 * `Y.Array("e2e")`; otherwise why not: "plaintext" (any other content),
 * "not-envelope", "incomplete" (the update needs structs the room does not
 * have, so it can't be checked), or "malformed".
 * `doc` itself is not changed.
 *
 * Plan W6.23 (review 12.11 #15): only the update's own structs are read.
 * The room is never encoded again; each struct whose parent the update does
 * not name (an insert next to an existing item) finds its neighbour with a
 * binary search in the room's struct store, as Yjs itself does when it
 * integrates the update. So the cost follows the update's size, not the
 * room's (src/__tests__/collabE2eeCheckCost.test.ts: a 4 MB room).
 * The room already passed this check for everything it holds, so what it
 * has stays valid; only what the update adds is new.
 */
export function checkE2eeUpdate(doc, update) {
  // Review of train 5 (H2): whatever a crafted update makes the reasoning below do, it is refused, never thrown.
  try {
    return checkStructs(doc, update);
  } catch {
    return "malformed";
  }
}

function checkStructs(doc, update) {
  let decoded;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return "malformed";
  }
  // Review of train 5 (H1): Yjs integrates only the last block of a client named in two
  // blocks (readClientsStructRefs), while decodeUpdate yields both, so the check would
  // reason about structs Yjs drops. Yjs never writes such an update: refuse it.
  const blocks = decoding.readVarUint(decoding.createDecoder(update));
  if (blocks !== new Set(decoded.structs.map((s) => s.id.client)).size) return "malformed";
  // Nor a struct of no length: it would sit in the room's store without moving its state.
  if (decoded.structs.some((s) => !(s.length > 0))) return "malformed";
  const store = doc.store;
  /** The update's structs per client, in clock order (as Yjs writes them). */
  const own = new Map();
  for (const s of decoded.structs) {
    const list = own.get(s.id.client);
    if (list) list.push(s);
    else own.set(s.id.client, [s]);
  }
  // Completeness, as Y.applyUpdate decides it: each client's structs must
  // start at or before what the room has of that client, without gaps.
  const reach = new Map();
  for (const [client, list] of own) {
    let next = Y.getState(store, client);
    let open = true;
    for (const s of list) {
      if (s instanceof Y.Skip) {
        open = false;
        continue;
      }
      if (!open || s.id.clock > next) return "incomplete";
      next = Math.max(next, s.id.clock + s.length);
    }
    reach.set(client, next);
  }
  const known = (client) => reach.get(client) ?? Y.getState(store, client);
  // Deletes of structs neither the room nor the update has wait in Yjs (pendingDs).
  for (const [client, ranges] of decoded.ds.clients) {
    for (const r of ranges) if (r.clock + r.len > known(client)) return "incomplete";
  }

  /**
   * Where an item of the update lands: "e2e" (the envelopes' array, as a list
   * entry), "nested" (inside a Y type in that array), "gc" (Yjs drops it: a
   * neighbour is garbage collected), "other", or "missing". Resolved through its origins, as Item.getMissing does.
   */
  const memo = new Map();
  const roomPlace = (struct) => {
    if (struct instanceof Y.GC) return "gc";
    if (!(struct instanceof Y.Item)) return "missing";
    const parent = struct.parent;
    if (!parent || parent._item !== null) return "other";
    if (doc.share.get(E2E_ARRAY) !== parent) return "other";
    return struct.parentSub === null ? "e2e" : "other";
  };
  // What the room already has of a client wins: Yjs skips the update's structs for those
  // clocks (and the known part of a struct that reaches past them), so an id the room has
  // means the room's struct, whatever the update says is there (review of train 5).
  const find = (id) => {
    if (!id) return null;
    if (id.clock < Y.getState(store, id.client)) {
      const theirs = structAt(store.clients.get(id.client), id.clock);
      return theirs ? { theirs } : { missing: true };
    }
    const mine = structAt(own.get(id.client), id.clock);
    return mine && !(mine instanceof Y.Skip) ? { mine } : { missing: true };
  };
  /** The clocks of `struct` the room already has (Yjs integrates only the rest, after the room's last one). */
  const knownOf = (struct) => Math.max(0, Y.getState(store, struct.id.client) - struct.id.clock);
  const placeOf = (start) => {
    // Iterative, origins and parents alike: an update of many inserts is a chain of origins.
    // `chain` holds the items walked, each with whether the walk then went up to its parent type.
    const chain = [];
    const seen = new Set();
    let item = start;
    let place;
    for (;;) {
      if (memo.has(item)) {
        place = memo.get(item);
        break;
      }
      if (item instanceof Y.GC) {
        place = "gc";
        break;
      }
      // An origin or parent that leads back to an item of this walk (itself, a cycle): no real update does that (H2).
      if (seen.has(item)) throw new Error("cycle");
      seen.add(item);
      // Partly known: Yjs integrates the rest with the room's last struct of the client as its
      // origin, and drops it when that struct is a GC (Item.getMissing with an offset).
      const offset = knownOf(item);
      const lastKnown = offset > 0 ? structAt(store.clients.get(item.id.client), item.id.clock + offset - 1) : null;
      if (offset > 0 && (!lastKnown || lastKnown instanceof Y.GC)) {
        place = lastKnown ? "gc" : "missing";
        break;
      }
      if (typeof item.parent === "string") {
        place = item.parent === E2E_ARRAY && item.parentSub === null ? "e2e" : "other";
        break;
      }
      if (item.parent !== null) {
        // A child of a nested type (there is none among envelopes): where is that type?
        const up = find(item.parent);
        if (!up || up.missing) place = "missing";
        else if (up.theirs) place = roomPlace(up.theirs) === "e2e" ? "nested" : up.theirs instanceof Y.GC ? "gc" : "other";
        else {
          chain.push({ item, up: true });
          item = up.mine;
          continue;
        }
        break;
      }
      const left = offset > 0 ? { theirs: lastKnown } : find(item.origin);
      const right = find(item.rightOrigin);
      if (left?.missing || right?.missing) {
        place = "missing";
        break;
      }
      const l = left?.theirs ? roomPlace(left.theirs) : null;
      const r = right?.theirs ? roomPlace(right.theirs) : null;
      if (l === "gc" || r === "gc" || left?.mine instanceof Y.GC || right?.mine instanceof Y.GC) {
        place = "gc";
        break;
      }
      if (l !== null) {
        place = l;
        break;
      }
      const next = left?.mine ?? (r !== null ? null : right?.mine);
      if (!next) {
        place = r ?? "missing";
        break;
      }
      chain.push({ item, up: false });
      item = next;
    }
    memo.set(item, place);
    for (let i = chain.length - 1; i >= 0; i--) {
      // Inside a type that sits in the array (or deeper) is "nested".
      if (chain[i].up && (place === "e2e" || place === "nested")) place = "nested";
      memo.set(chain[i].item, place);
    }
    return place;
  };

  let notEnvelope = false;
  for (const s of decoded.structs) {
    if (!(s instanceof Y.Item)) continue; // GC and Skip carry no content
    // Yjs resolves the references of every struct, known or not (Item.getMissing): one that is
    // missing parks the update, and one to the struct itself or later in its own client throws.
    for (const ref of [s.origin, s.rightOrigin, s.parent instanceof Y.ID ? s.parent : null]) {
      if (!ref) continue;
      if (ref.client === s.id.client && ref.clock >= s.id.clock) return "malformed";
      if (find(ref)?.missing) return "incomplete";
    }
    if (knownOf(s) >= s.length) continue; // the room has all of it: Yjs integrates none of it
    const place = placeOf(s);
    if (place === "missing") return "incomplete";
    if (place === "gc") continue; // Yjs keeps none of it
    if (place === "other") return "plaintext";
    if (place === "nested") {
      notEnvelope = true; // inside a Y type that sits in the array instead of an envelope
      continue;
    }
    const c = s.content;
    if (c instanceof Y.ContentDeleted) continue;
    if (!(c instanceof Y.ContentAny) || !c.arr.every(isEnvelope)) notEnvelope = true;
  }
  return notEnvelope ? "not-envelope" : null;
}

/**
 * The Yjs update a Hocuspocus client message carries (sync step 2 or an
 * update), or null for every other message. For `beforeHandleMessage`.
 */
export function updateInMessage(message) {
  try {
    const d = decoding.createDecoder(message);
    decoding.readVarString(d);
    const type = decoding.readVarUint(d);
    if (type !== MessageType.Sync && type !== MessageType.SyncReply) return null;
    const step = decoding.readVarUint(d);
    if (step !== SyncStep2 && step !== SyncUpdate) return null;
    return decoding.readVarUint8Array(d);
  } catch {
    return null;
  }
}

function frame(address, type, write) {
  const e = encoding.createEncoder();
  encoding.writeVarString(e, address);
  encoding.writeVarUint(e, type);
  write?.(e);
  return encoding.toUint8Array(e);
}

/**
 * One room. `state` is what was stored (or null); `onChange(doc, origin)` follows
 * every change, for the host to store (debounced).
 * `authorize(token, documentName, socket)` resolves true to let a connection in;
 * `onAuthenticated(socket, address)` follows (the Worker stores it with the
 * socket). Updates that would make the room larger than `maxBytes` close
 * the connection.
 *
 *   const room = createRelayRoom({ name, state, authorize, onChange })
 *   const peer = room.join({ send(bytes), close(code, reason) })
 *   peer.receive(bytes) … peer.leave()
 */
export function createRelayRoom({ name, state = null, authorize, onChange = () => {}, onAuthenticated = () => {}, e2eeOnly = true, maxBytes = 4_000_000 }) {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  const awareness = new Awareness(doc);
  awareness.setLocalState(null); // the server is not a participant
  const peers = new Set();
  let bytes = state ? state.byteLength : 0;
  // The exact size again after each update, at the cost of what the update touched (roomSize.mjs).
  const meter = createRoomMeter(doc);
  if (state) meter.measure(); // why: the stored room's structs are counted at load, not in its first message

  // Review of train 5 (H1, second line): the check refuses updates Yjs would park. Should one
  // get through anyway, what it left pending is dropped and its sender closed: a room never
  // holds structs or deletions it could not check (the probe check refused them as "incomplete").
  let dropped = false;
  const dropPending = () => {
    if (doc.store.pendingStructs === null && doc.store.pendingDs === null) return;
    doc.store.pendingStructs = null;
    doc.store.pendingDs = null;
    dropped = true;
  };

  doc.on("update", (update, origin) => {
    dropPending(); // before the size: what is dropped is not the room's
    for (const p of peers) if (p !== origin && p.ready) p.socket.send(frame(p.address, MessageType.Sync, (e) => {
      encoding.writeVarUint(e, SyncUpdate);
      encoding.writeVarUint8Array(e, update);
    }));
    bytes = meter.measure(); // = Y.encodeStateAsUpdate(doc).byteLength
    onChange(doc, origin); // origin: the peer whose update it was (its socket), or null
  });
  awareness.on("update", ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    const msg = encodeAwarenessUpdate(awareness, changed);
    for (const p of peers) if (p.ready) p.socket.send(frame(p.address, MessageType.Awareness, (e) => encoding.writeVarUint8Array(e, msg)));
    if (origin && origin.clients) for (const id of added) origin.clients.add(id);
  });

  function applyChecked(peer, update) {
    if (e2eeOnly) {
      const why = checkE2eeUpdate(doc, update);
      if (why) {
        // As Hocuspocus does: a CLOSE message with the reason, for the
        // provider, then the socket.
        peer.socket.send(frame(peer.address, MessageType.SyncStatus, (e) => encoding.writeVarUint(e, 0)));
        peer.socket.send(frame(peer.address, MessageType.CLOSE, (e) => encoding.writeVarString(e, `e2ee-only: ${why}`)));
        peer.socket.close(Close.Forbidden.code, `e2ee-only: ${why}`);
        return false;
      }
    }
    if (bytes + update.byteLength > maxBytes) {
      peer.socket.close(Close.TooLarge.code, Close.TooLarge.reason);
      return false;
    }
    dropped = false;
    try {
      Y.applyUpdate(doc, update, peer);
    } catch {
      dropPending();
      peer.socket.close(Close.Forbidden.code, "e2ee-only: malformed");
      return false;
    }
    dropPending(); // an update that integrated nothing emits no "update" event
    if (dropped) {
      peer.socket.send(frame(peer.address, MessageType.SyncStatus, (e) => encoding.writeVarUint(e, 0)));
      peer.socket.send(frame(peer.address, MessageType.CLOSE, (e) => encoding.writeVarString(e, "e2ee-only: incomplete")));
      peer.socket.close(Close.Forbidden.code, "e2ee-only: incomplete");
      return false;
    }
    peer.socket.send(frame(peer.address, MessageType.SyncStatus, (e) => encoding.writeVarUint(e, 1)));
    return true;
  }

  return {
    doc,
    get size() {
      return bytes;
    },
    get peerCount() {
      return peers.size;
    },
    state: () => Y.encodeStateAsUpdate(doc),
    /**
     * A connection joins. `resume` brings back one that was already let in
     * (a Durable Object woken from hibernation keeps the socket, not this
     * object).
     */
    join(socket, resume = null) {
      const peer = { socket, ready: Boolean(resume?.ready), address: resume?.address ?? name, clients: new Set(), queue: [] };
      peers.add(peer);
      const handle = (data) => {
        const d = decoding.createDecoder(data);
        const address = decoding.readVarString(d);
        const sep = address.indexOf("\0");
        if ((sep === -1 ? address : address.slice(0, sep)) !== name) return socket.close(Close.Forbidden.code, "wrong-room");
        peer.address = address;
        const type = decoding.readVarUint(d);
        switch (type) {
          case MessageType.Sync:
          case MessageType.SyncReply: {
            const step = decoding.readVarUint(d);
            if (step === SyncStep1) {
              const sv = decoding.readVarUint8Array(d);
              socket.send(frame(address, MessageType.Sync, (e) => {
                encoding.writeVarUint(e, SyncStep2);
                encoding.writeVarUint8Array(e, Y.encodeStateAsUpdate(doc, sv));
              }));
              // Ask for what the client has (as Hocuspocus does over a socket:
              // a Sync message; SyncReply is only for direct connections).
              if (type === MessageType.Sync)
                socket.send(frame(address, MessageType.Sync, (e) => {
                  encoding.writeVarUint(e, SyncStep1);
                  encoding.writeVarUint8Array(e, Y.encodeStateVector(doc));
                }));
            } else if (step === SyncStep2 || step === SyncUpdate) {
              applyChecked(peer, decoding.readVarUint8Array(d));
            }
            return;
          }
          case MessageType.Awareness:
            applyAwarenessUpdate(awareness, decoding.readVarUint8Array(d), peer);
            return;
          case MessageType.QueryAwareness:
            socket.send(frame(address, MessageType.Awareness, (e) =>
              encoding.writeVarUint8Array(e, encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()])),
            ));
            return;
          case MessageType.CLOSE:
            socket.close(1000, "provider_initiated");
            return;
          default:
            return; // stateless messages and the rest: nothing to relay here
        }
      };
      return {
        async receive(data) {
          if (peer.ready) return handle(data);
          const d = decoding.createDecoder(data);
          const address = decoding.readVarString(d);
          const type = decoding.readVarUint(d);
          if (type !== MessageType.Auth) {
            if (peer.queue.length >= 64) return socket.close(Close.Reset.code, Close.Reset.reason);
            peer.queue.push(data);
            return;
          }
          decoding.readVarUint(d); // AuthToken
          const token = decoding.readVarString(d);
          const sep = address.indexOf("\0");
          const docName = sep === -1 ? address : address.slice(0, sep);
          let ok = false;
          try {
            ok = docName === name && (await authorize(token, docName, socket));
          } catch {
            ok = false;
          }
          if (!ok) {
            socket.send(frame(address, MessageType.Auth, (e) => {
              encoding.writeVarUint(e, AuthPermissionDenied);
              encoding.writeVarString(e, "permission-denied");
            }));
            return;
          }
          peer.address = address;
          socket.send(frame(address, MessageType.Auth, (e) => {
            encoding.writeVarUint(e, AuthAuthenticated);
            encoding.writeVarString(e, "read-write");
          }));
          peer.ready = true;
          onAuthenticated(socket, address);
          if (awareness.getStates().size > 0)
            socket.send(frame(address, MessageType.Awareness, (e) =>
              encoding.writeVarUint8Array(e, encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()])),
            ));
          const queued = peer.queue.splice(0);
          for (const q of queued) handle(q);
        },
        leave() {
          peers.delete(peer);
          if (peer.clients.size) removeAwarenessStates(awareness, [...peer.clients], null);
        },
      };
    },
    destroy() {
      awareness.destroy();
      doc.destroy();
    },
  };
}

