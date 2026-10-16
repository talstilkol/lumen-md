/**
 * Collab room ⇄ URL-hash helpers.
 *
 * Kept in their own yjs-free module: the boot path checks `#room=` on every
 * mount, and importing these from collab/yjs.ts dragged the whole yjs +
 * y-webrtc stack (~60KB gz) into the eager bundle just to read a URL.
 */

/** Read the room name from `#room=<name>` in the URL. */
export function readRoomFromHash(): string | null {
  if (typeof location === "undefined") return null;
  const m = location.hash.match(/[#&]room=([\w-]+)/);
  return m?.[1] ?? null;
}

/**
 * Write `#room=<name>` into the URL, KEEPING a `password=` fragment that
 * was there (the documented `#room=…&password=…` join link). Dropping it
 * would lose the room password on refresh — the session would then attach
 * the plaintext document to the providers instead of the encrypted
 * transport. `null` clears both (the session ended).
 */
export function setRoomInHash(name: string | null): void {
  if (typeof location === "undefined") return;
  if (!name) {
    if (/^#(room|password)=/.test(location.hash) || /[#&]room=/.test(location.hash)) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    return;
  }
  const pw = location.hash.match(/[#&]password=([^&]+)/)?.[1];
  history.replaceState(null, "", `#room=${name}${pw ? `&password=${pw}` : ""}`);
}
