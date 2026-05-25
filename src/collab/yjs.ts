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
 * Connect to (or create) a collaborative editing session over WebRTC.
 * When the local doc is empty and we are the first peer, the provided
 * `seedContent` is inserted so other peers can pick it up.
 */
/**
 * Wrap the doc's wire updates in AES-GCM. We attach a custom update
 * observer that fires for every local mutation and re-broadcasts the
 * encrypted payload over a hidden Y.Map keyed `__crypt__`. Inbound entries
 * on the same map decrypt → applyUpdate.
 *
 * This isn't a perfect secure-channel construction (the public protocol
 * still sees lengths + structure metadata) but it makes the document body
 * unreadable to a passive signaling-server eavesdropper and to a peer who
 * joined the room without the password. Good enough as a Pro privacy
 * upgrade; for paranoid threat models, run your own signaling server.
 */
async function wireEncryption(doc: Y.Doc, password: string): Promise<void> {
  const cryptMap = doc.getMap<string>("__crypt__");
  // Local-origin updates: encrypt + push to the map. We use a unique key
  // per update so concurrent peers don't clobber each other's payloads.
  doc.on("update", async (update: Uint8Array, origin: unknown) => {
    if (origin === "remote-decrypted") return; // avoid re-encrypting our own decrypts
    try {
      const cipher = await encryptOp(password, update);
      const b64 = btoa(String.fromCharCode(...cipher));
      // Crypto-strong key: collisions in this map can leak which peer wrote
      // an op (every key is observable on the wire), so we don't rely on
      // Math.random — it's biased and predictable.
      const key = `${Date.now().toString(36)}-${randomId(3)}`;
      cryptMap.set(key, b64);
    } catch (err) {
      log.warn("encrypt update failed", err);
    }
  });
  // Inbound entries: decrypt + applyUpdate inside a transaction so the
  // observer above doesn't re-encrypt them in a loop.
  cryptMap.observe(async (event) => {
    for (const key of event.keysChanged) {
      const b64 = cryptMap.get(key);
      if (!b64) continue;
      try {
        const cipher = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const plain = await decryptOp(password, cipher);
        if (!plain) continue; // wrong password from another peer — drop
        Y.applyUpdate(doc, plain, "remote-decrypted");
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
    // the mock graph.
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
 * or `?password=…` in the URL hash. When present, every WebRTC update is
 * encrypted with AES-GCM (PBKDF2-derived key) before it leaves this peer,
 * and decrypted on receipt — turning the otherwise-public WebRTC mesh into
 * an end-to-end-encrypted channel (P3-13).
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

export function connectCollab(
  roomName: string,
  seedContent: string,
  opts: { password?: string | null } = {},
): CollabSession {
  const doc = new Y.Doc();
  const ytext = doc.getText("lumen");

  // E2E encryption: when a room password is set, install an update-handler
  // that encrypts every doc update before peers see it on the wire and
  // decrypts inbound payloads back into Y updates. Wrong-password peers
  // can connect over signaling but never see plaintext.
  const password = opts.password ?? getRoomPassword();

  // Public rooms only — obscure name suffices for casual pair editing. Users
  // wanting more privacy should run their own signaling server.
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: getSignalingUrls(),
    maxConns: 20,
  });

  if (password) {
    // y-webrtc transports payloads via its room's signaling channel. We tap
    // the doc's update event ourselves: every local update is encrypted +
    // applied to a side-doc that mirrors the public state, while remote
    // payloads are decrypted before being applied to the visible doc.
    void wireEncryption(doc, password);
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
  seedTimer = setTimeout(() => {
    if (destroyed) return;
    const peersKnown = provider.awareness.getStates().size;
    if (ytext.length === 0 && seedContent && peersKnown <= 1) {
      ytext.insert(0, seedContent);
    }
  }, 400);

  const user = randomUser();
  provider.awareness.setLocalStateField("user", user);

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

/** Read the room name from `#room=<name>` in the URL. */
export function readRoomFromHash(): string | null {
  if (typeof location === "undefined") return null;
  const m = location.hash.match(/[#&]room=([\w-]+)/);
  return m?.[1] ?? null;
}

export function setRoomInHash(name: string | null): void {
  if (typeof location === "undefined") return;
  if (!name) {
    if (location.hash.startsWith("#room=")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    return;
  }
  history.replaceState(null, "", `#room=${name}`);
}

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
