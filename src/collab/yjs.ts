import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import type { Awareness } from "y-protocols/awareness";
import { randomChoice, randomInt, randomId } from "../lib/cryptoRandom";
import { log } from "../lib/logger";
import { encryptOp, decryptOp } from "./encryption";

export interface CollabUser {
  name: string;
  color: string;
  colorLight: string;
}

/**
 * Lightweight `WebsocketProvider`-shaped contract — we declare this locally so
 * the optional `y-websocket` package doesn't have to be bundled for users on
 * the WebRTC-only path.
 */
interface WebsocketLike {
  destroy(): void;
}

export interface CollabSession {
  doc: Y.Doc;
  ytext: Y.Text;
  awareness: Awareness;
  provider: WebrtcProvider;
  /** Optional persistent provider (y-websocket) — null on WebRTC-only sessions. */
  websocketProvider: WebsocketLike | null;
  roomName: string;
  user: CollabUser;
  /** Tear down providers + free Yjs structures. */
  destroy: () => void;
}

/**
 * Default signaling-server endpoints. Order matters — the first entry is
 * tried first; the rest are used only if it fails. `signal.lumen.md` is
 * Lumen's own deployed service (`sync-server/`); the public yjs.dev
 * endpoints are kept as last-resort fallbacks for users running off-cluster.
 *
 * Override at runtime via `localStorage["lumen.collab.signaling"]` or the
 * `VITE_WEBRTC_SIGNALING_URL` env var (single URL or comma-separated list).
 */
const PUBLIC_SIGNALING_FALLBACK = [
  "wss://signal.lumen.md",
  "wss://signaling.yjs.dev",
  "wss://y-webrtc-signaling-eu.herokuapp.com",
];

const getSignalingUrls = (): string[] => {
  const custom = typeof localStorage !== "undefined"
    ? localStorage.getItem("lumen.collab.signaling")
    : null;
  if (custom) return custom.split(",").map((s) => s.trim()).filter(Boolean);
  const envUrl = typeof import.meta !== "undefined"
    ? (import.meta as ImportMeta & { env?: { VITE_WEBRTC_SIGNALING_URL?: string } }).env?.VITE_WEBRTC_SIGNALING_URL
    : undefined;
  if (envUrl) return envUrl.split(",").map((s) => s.trim()).filter(Boolean);
  return PUBLIC_SIGNALING_FALLBACK;
};

const NAMES = [
  "Aurora",
  "Blaze",
  "Cascade",
  "Cinder",
  "Comet",
  "Echo",
  "Ember",
  "Glacier",
  "Halcyon",
  "Indigo",
  "Lumen",
  "Marble",
  "Nimbus",
  "Onyx",
  "Pegasus",
  "Quartz",
  "Rune",
  "Saffron",
  "Tempest",
  "Vesper",
  "Willow",
  "Zephyr",
];

function randomUser(): CollabUser {
  const name = randomChoice(NAMES);
  const hue = randomInt(360);
  return {
    name,
    color: `hsl(${hue} 70% 55%)`,
    colorLight: `hsl(${hue} 70% 85%)`,
  };
}

/** Generate a fresh, friendly room name. */
export function makeRoomName(): string {
  const adjectives = [
    "calm",
    "bright",
    "swift",
    "wild",
    "pale",
    "amber",
    "hidden",
    "lucky",
    "open",
    "kind",
  ];
  const nouns = [
    "river",
    "valley",
    "comet",
    "ember",
    "cloud",
    "harbor",
    "meadow",
    "summit",
    "lantern",
    "cipher",
  ];
  const a = randomChoice(adjectives);
  const b = randomChoice(nouns);
  const n = randomInt(90) + 10;
  return `lumen-${a}-${b}-${n}`;
}

/**
 * Transaction origin used for this layer's own writes to the `__crypt__` map.
 * Updates carrying it are never re-encrypted (that recursion -- every
 * `cryptMap.set` emitting an update that was encrypted again -- previously
 * grew the map forever).
 */
export const CRYPT_ORIGIN = Symbol("lumen.collab.crypt");
/** Origin used when applying a decrypted payload back into the doc. */
export const DECRYPT_ORIGIN = "remote-decrypted";
export const CRYPT_MAP_NAME = "__crypt__";

/**
 * Mirror every local doc update, AES-GCM encrypted, into a hidden Y.Map
 * (`__crypt__`) keyed per update. Inbound entries on the same map are
 * decrypted and applied with `DECRYPT_ORIGIN`.
 *
 * SECURITY -- read before relying on this:
 * The encrypted entries ride in the SAME Y.Doc as the plaintext `lumen`
 * text, and y-webrtc syncs the whole doc. So the plaintext still reaches
 * every connected peer, including peers that joined without (or with the
 * wrong) password, and anyone who can read the WebRTC/y-websocket traffic
 * of a peer. This layer therefore provides NO confidentiality today.
 *
 * TODO(collab-e2e): real E2E needs the plaintext doc kept local-only and
 * only ciphertext on the wire -- e.g. pass `password` to WebrtcProvider
 * (y-webrtc's built-in room encryption) and sync a separate ciphertext
 * doc instead of the visible one. Tracked as a redesign; not attempted here.
 */
export function wireEncryption(doc: Y.Doc, password: string): void {
  const cryptMap = doc.getMap<string>(CRYPT_MAP_NAME);
  const cryptType = cryptMap as unknown as Y.AbstractType<unknown>;

  doc.on(
    "update",
    async (update: Uint8Array, origin: unknown, _doc: Y.Doc, tr?: Y.Transaction) => {
      // Our own crypt-map writes and our decrypt applies must not be
      // re-encrypted, or every write triggers another write forever.
      if (origin === CRYPT_ORIGIN || origin === DECRYPT_ORIGIN) return;
      if (tr) {
        // Only encrypt edits made on this peer -- remote updates were
        // already encrypted by their author.
        if (!tr.local) return;
        // Updates that only touch the crypt map carry no document content.
        if (tr.changed.size > 0 && Array.from(tr.changed.keys()).every((t) => t === cryptType)) {
          return;
        }
      }
      try {
        const cipher = await encryptOp(password, update);
        const b64 = btoa(String.fromCharCode(...cipher));
        // Crypto-strong key: collisions in this map can leak which peer wrote
        // an op (every key is observable on the wire), so we don't rely on
        // Math.random -- it's biased and predictable.
        const key = `${Date.now().toString(36)}-${randomId(3)}`;
        doc.transact(() => cryptMap.set(key, b64), CRYPT_ORIGIN);
      } catch (err) {
        log.warn("encrypt update failed", err);
      }
    },
  );

  // Inbound entries: decrypt + applyUpdate with DECRYPT_ORIGIN so the
  // observer above doesn't re-encrypt them.
  cryptMap.observe(async (event) => {
    // Entries we just wrote ourselves are already applied locally.
    if (event.transaction.origin === CRYPT_ORIGIN) return;
    for (const key of event.keysChanged) {
      const b64 = cryptMap.get(key);
      if (!b64) continue;
      try {
        const cipher = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const plain = await decryptOp(password, cipher);
        if (!plain) continue; // wrong password from another peer -- drop
        Y.applyUpdate(doc, plain, DECRYPT_ORIGIN);
      } catch (err) {
        log.warn("decrypt update failed", err);
      }
    }
  });
}

/** Optional persistent collab WebSocket URL (y-websocket compatible). */
function getWebsocketUrl(): string | null {
  const fromStorage =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("lumen.collab.ws")
      : null;
  if (fromStorage) return fromStorage;
  const envUrl =
    typeof import.meta !== "undefined"
      ? (import.meta as ImportMeta & { env?: { VITE_YJS_WEBSOCKET_URL?: string } })
          .env?.VITE_YJS_WEBSOCKET_URL
      : undefined;
  return envUrl ?? null;
}

/**
 * Best-effort attach of a persistent y-websocket provider in the background.
 * The package is dynamically imported so a build without it never pays the
 * bundle cost. Failures are swallowed — the session still works over WebRTC.
 */
async function attachWebsocketProvider(
  url: string,
  roomName: string,
  doc: Y.Doc,
): Promise<WebsocketLike | null> {
  try {
    // Static-string dynamic import so vi.mock("y-websocket") resolves
    // here in tests. The previous indirection-via-variable defeated
    // the mock graph. Vite's import-analysis plugin would try to
    // resolve this at dev-server start, which crashes when the user
    // hasn't installed the package — so vite.config.ts adds a
    // resolve.alias mapping "y-websocket" → the test stub so the
    // analyzer always finds *something*. The try/catch handles any
    // runtime failure regardless.
    const mod = (await import("y-websocket")) as unknown as {
      WebsocketProvider: new (
        url: string,
        room: string,
        doc: Y.Doc,
        opts?: Record<string, unknown>,
      ) => WebsocketLike;
    };
    return new mod.WebsocketProvider(url, roomName, doc, { connect: true });
  } catch (err) {
    log.warn("y-websocket attach failed", err);
    return null;
  }
}

/**
 * Read the optional room password from `localStorage["lumen.collab.password"]`
 * or `?password=…` in the URL hash. When present, local updates are also
 * mirrored AES-GCM-encrypted into the doc (see `wireEncryption` -- the
 * plaintext is still synced alongside, so this is NOT end-to-end
 * encryption yet).
 */
function getRoomPassword(): string | null {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("lumen.collab.password");
    if (stored) return stored;
  }
  if (typeof location !== "undefined") {
    const m = location.hash.match(/[#&]password=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

/**
 * Connect to (or create) a collaborative editing session over WebRTC.
 * When the local doc is empty and we are the first peer, the provided
 * `seedContent` is inserted so other peers can pick it up.
 */
export function connectCollab(
  roomName: string,
  seedContent: string,
  opts: { password?: string | null; isNewRoom?: boolean } = {},
): CollabSession {
  const doc = new Y.Doc();
  const ytext = doc.getText("lumen");

  // Optional room password: mirrors encrypted updates into the doc. NOTE the
  // plaintext doc is still synced too -- see the SECURITY note on
  // `wireEncryption`.
  const password = opts.password ?? getRoomPassword();

  // Public rooms only — obscure name suffices for casual pair editing. Users
  // wanting more privacy should run their own signaling server.
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: getSignalingUrls(),
    maxConns: 20,
  });

  if (password) {
    wireEncryption(doc, password);
  }

  // If a persistent server is configured, attach a WebsocketProvider in the
  // background. Doc state from the server is merged into the same Y.Doc so
  // late joiners see history even when no other peer is online.
  const wsUrl = getWebsocketUrl();
  let websocketProvider: WebsocketLike | null = null;
  if (wsUrl) {
    void attachWebsocketProvider(wsUrl, roomName, doc).then((p) => {
      if (destroyed) {
        p?.destroy();
        return;
      }
      websocketProvider = p;
    });
  }

  // Seed initial content once we know we're the only one in the room.
  // y-webrtc reports peers via `provider.awareness` and `provider.room`. For
  // simplicity we wait a short tick: if no remote state has arrived, insert.
  let seedTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  if (opts.isNewRoom && seedContent && ytext.length === 0) {
    // New room created by this peer: seed synchronously so the editor's
    // char-level Yjs binding (y-codemirror `ySync`) has content to bind to.
    // A delayed seed would let the binding momentarily clear the editor.
    ytext.insert(0, seedContent);
  } else {
    // Joining (or unknown): wait a tick and only seed if we're still alone and
    // no remote content has arrived — so we never clobber an existing room.
    seedTimer = setTimeout(() => {
      if (destroyed) return;
      const peersKnown = provider.awareness.getStates().size;
      if (ytext.length === 0 && seedContent && peersKnown <= 1) {
        ytext.insert(0, seedContent);
      }
    }, 400);
  }

  const user = randomUser();
  provider.awareness.setLocalStateField("user", user);

  // Wire version-history snapshots (5-min interval during collab).
  let stopSnapshots: (() => void) | null = null;
  import("./versionHistory").then(({ startSnapshotInterval }) => {
    stopSnapshots = startSnapshotInterval(
      roomName,
      () => ytext.toString(),
      () => ({ name: user.name, clientId: doc.clientID }),
    );
  }).catch(() => {});

  return {
    doc,
    ytext,
    awareness: provider.awareness,
    provider,
    get websocketProvider() {
      return websocketProvider;
    },
    roomName,
    user,
    destroy() {
      destroyed = true;
      if (seedTimer) {
        clearTimeout(seedTimer);
        seedTimer = null;
      }
      if (stopSnapshots) {
        stopSnapshots();
        stopSnapshots = null;
      }
      try {
        provider.destroy();
      } catch {
        /* */
      }
      try {
        websocketProvider?.destroy();
      } catch {
        /* */
      }
      try {
        doc.destroy();
      } catch {
        /* */
      }
    },
  };
}

// URL-hash helpers live in ./roomUrl (yjs-free) so the boot path can read
// `#room=` without pulling this module's yjs/y-webrtc stack; re-exported here
// for existing importers.
export { readRoomFromHash, setRoomInHash } from "./roomUrl";

/** Pull a friendly snapshot of current peers from the awareness state. */
export interface CollabPeer {
  clientId: number;
  user: CollabUser;
  isSelf: boolean;
}

export function snapshotPeers(session: CollabSession): CollabPeer[] {
  const states = session.awareness.getStates();
  const out: CollabPeer[] = [];
  const selfId = session.doc.clientID;
  states.forEach((state, clientId) => {
    const user = state?.user as CollabUser | undefined;
    if (!user) return;
    out.push({ clientId, user, isSelf: clientId === selfId });
  });
  // self first, others after, stable order
  out.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.clientId - b.clientId);
  return out;
}
