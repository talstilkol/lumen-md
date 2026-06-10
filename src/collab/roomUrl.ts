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
