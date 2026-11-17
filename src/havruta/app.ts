/**
 * The app side of havruta (plan W12.H1, W12.H3): the relay, the device
 * store and the Sefaria path a study room uses. Loaded on demand (the study
 * screen, W12.H2); nothing here is in the startup bundle.
 *
 *  - Relay: the persistent collab server the user configured, when the
 *    plan includes it (collab/yjs.ts persistentCollabUrl), through the same
 *    provider as a shared note (collab/persistentProvider), end-to-end
 *    encrypted (e2ee: true seals the room on the server). Airplane mode: no
 *    connection at all; the session works on the device.
 *  - Device store: IndexedDB (idb-keyval), one entry per room, cleared at
 *    the end of the session.
 *  - Text: sources/sefaria/app.ts `lookup`, the path the app already
 *    allows for Sefaria (the offline copy first, then the privacy ledger's
 *    consented fetch). In airplane mode only the offline copy.
 */
import { createStore, del, get, set } from "idb-keyval";
import { airplaneModeOn } from "../privacy/airplane";
import { getSecret } from "../lib/secretStore";
import { lookup } from "../sources/sefaria/app";
import { isOPFSAvailable, readWorkspaceFile, workspaceHasFile } from "../storage/workspace";
import type { SourceRef } from "../sources/sefaria/refs";
import { newHavrutaRoomName, type HavrutaRef } from "./room";
import { openHavruta, type HavrutaPersist, type HavrutaSession } from "./session";
import { deleteRoomOnRelay } from "./relayAdmin";
import type { StudyTextResult } from "./text";
import { loadStudyText, studyTextOf } from "./text";

const store = typeof indexedDB !== "undefined" ? createStore("lumen-havruta", "rooms") : undefined;

export const devicePersist: HavrutaPersist = {
  load: async (room) => ((await get<Uint8Array>(room, store)) ?? null),
  save: (room, state) => set(room, state, store),
  clear: (room) => del(room, store),
};

/** A fresh room password: 128 random bits, base64url. */
export function newRoomPassword(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ACCESS_KEY = () => getSecret("lumen.collab.wsToken");

/** Open (or join) a study room. Without a relay, or in airplane mode, it starts on the device. */
export async function startHavruta(opts: { ref?: HavrutaRef; room?: string; password?: string; onEnded?: () => void }): Promise<{ session: HavrutaSession; password: string }> {
  const room = opts.room ?? newHavrutaRoomName();
  const password = opts.password ?? newRoomPassword();
  const { persistentCollabUrl } = await import("../collab/yjs");
  const url = await persistentCollabUrl();
  const session = await openHavruta({
    room,
    password,
    ref: opts.ref,
    persist: devicePersist,
    onEnded: opts.onEnded,
    async connect(transport, awareness) {
      if (airplaneModeOn() || !url) throw new Error("offline");
      const { createPersistentProvider } = await import("../collab/persistentProvider");
      const p = await createPersistentProvider(url, room, transport, ACCESS_KEY(), { e2ee: true, password, awareness });
      await new Promise<void>((resolve, reject) => {
        if (p.synced) return resolve();
        const timer = setTimeout(() => reject(new Error("timeout")), 8000);
        p.on("sync", () => (clearTimeout(timer), resolve()));
        p.on("connection-error", () => (clearTimeout(timer), p.destroy(), reject(new Error("unreachable"))));
      });
      return p;
    },
    deleteOnRelay: async () => {
      if (!url || airplaneModeOn()) return; // offline: the relay forgets it at 30 days
      await deleteRoomOnRelay({ serverUrl: url, room, password, accessKey: ACCESS_KEY() }).catch(() => undefined);
    },
  });
  return { session, password };
}

/** The passage on this side: the offline copy first (sources/sefaria/app `lookup` reads it with no request); Sefaria only through that allowed, consented path; never in airplane mode. */
export async function studyText(ref: SourceRef, confirm: () => Promise<boolean>): Promise<StudyTextResult> {
  if (airplaneModeOn()) {
    const storage = {
      async read(path: string) {
        if (!isOPFSAvailable()) return null;
        try {
          return (await workspaceHasFile(path)) ? await readWorkspaceFile(path) : null;
        } catch {
          return null;
        }
      },
      write: async () => undefined,
    };
    return loadStudyText(ref, { storage, fetch: () => Promise.reject(new Error("airplane mode")), offline: () => true });
  }
  const r = await lookup(ref, confirm);
  return r ? studyTextOf(r.passage, r.from) : { unavailable: "declined" };
}
