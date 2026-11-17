/**
 * Consent for the map's online tiles (audit r4 A3 #6, privacy). Loading
 * OpenStreetMap tiles tells tile.openstreetmap.org which area is being
 * looked at, so it is off until the user turns it on — on the map itself
 * (its "Load map tiles" button) — and can be turned off there again. An
 * offline basemap in the vault (W13.G3) needs no consent: it asks no server.
 *
 * Kept on this device (localStorage), like the airplane switch; every open
 * map hears a change (the `lumen:map-tiles` event).
 */
const KEY = "lumen.map.onlineTiles";
export const MAP_TILES_EVENT = "lumen:map-tiles";

/** Whether the user allowed online map tiles (default: no). */
export function onlineTilesAllowed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // why: no storage (private mode, blocked): no consent is recorded, so none is assumed
    return false;
  }
}

export function setOnlineTilesAllowed(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // why: no storage: the choice holds for this page only (the event below still tells the open maps)
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MAP_TILES_EVENT, { detail: on }));
}
