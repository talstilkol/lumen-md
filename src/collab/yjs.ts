import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import type { Awareness } from "y-protocols/awareness";

export interface CollabUser {
  name: string;
  color: string;
  colorLight: string;
}

export interface CollabSession {
  doc: Y.Doc;
  ytext: Y.Text;
  awareness: Awareness;
  provider: WebrtcProvider;
  roomName: string;
  user: CollabUser;
  /** Tear down WebRTC + free Yjs structures. */
  destroy: () => void;
}

const SIGNALING = [
  "wss://signaling.yjs.dev",
  "wss://y-webrtc-eu.fly.dev",
];

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
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const hue = Math.floor(Math.random() * 360);
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
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const b = nouns[Math.floor(Math.random() * nouns.length)];
  const n = Math.floor(Math.random() * 90 + 10);
  return `lumen-${a}-${b}-${n}`;
}

/**
 * Connect to (or create) a collaborative editing session over WebRTC.
 * When the local doc is empty and we are the first peer, the provided
 * `seedContent` is inserted so other peers can pick it up.
 */
export function connectCollab(
  roomName: string,
  seedContent: string,
): CollabSession {
  const doc = new Y.Doc();
  const ytext = doc.getText("lumen");

  // Public rooms only — obscure name suffices for casual pair editing. Users
  // wanting more privacy should run their own signaling server.
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: SIGNALING,
    maxConns: 20,
  });

  // Seed initial content once we know we're the only one in the room.
  // y-webrtc reports peers via `provider.awareness` and `provider.room`. For
  // simplicity we wait a short tick: if no remote state has arrived, insert.
  setTimeout(() => {
    if (ytext.length === 0 && seedContent) {
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
    roomName,
    user,
    destroy() {
      try {
        provider.destroy();
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
