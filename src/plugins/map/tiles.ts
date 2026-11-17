/**
 * The map's background (plans W12.F7, W13.G3). Every map (the ```map block,
 * the database map view and the GeoJSON/GPX viewer) adds it through here:
 *
 * 1. an offline basemap in the vault (`.lumen/maps/*.pmtiles`, W13.G3) when
 *    there is one — drawn from the file, no tile server is ever asked, in
 *    airplane mode or not, labels in the UI's language;
 * 2. else the OpenStreetMap tiles — the one network request a map makes —
 *    unless airplane mode is on;
 * 3. else no background: the shapes and markers, which are local, still show.
 */
import type * as Leaflet from "leaflet";
import { airplaneModeOn } from "../../privacy/airplane";

export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
/** Kept in step with src/map/offlineStore.ts (OFFLINE_FLAG): set while a basemap is in the vault. */
const OFFLINE_FLAG = "lumen.map.offline";

function networkTiles(L: typeof Leaflet, map: Leaflet.Map): boolean {
  if (airplaneModeOn()) return false;
  // privacy-ledger: map tiles are image loads from tile.openstreetmap.org (no note content is sent; the tile coordinates reveal the area viewed). Off in airplane mode, and never used while an offline basemap is in the vault.
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
  return true;
}

const hasOfflineHint = () => {
  try {
    return localStorage.getItem(OFFLINE_FLAG) === "1";
  } catch {
    // why: no storage: look in the vault (below) all the same
    return false;
  }
};

/**
 * Add the background. With a basemap known to be in the vault (the hint
 * that src/map/offlineStore.ts keeps), the map draws from the file and asks
 * no tile server; the network tiles come only if the file turns out to be
 * gone. Without the hint the network tiles come at once, as before, and if
 * the vault does hold a basemap (synced from another device) the map
 * switches to it and the hint is set for next time. Returns whether a
 * background is coming.
 */
export function addBaseTiles(L: typeof Leaflet, map: Leaflet.Map, opts: { lang?: string; dark?: boolean } = {}): boolean {
  const lang = opts.lang ?? ((typeof document !== "undefined" && document.documentElement.lang) || "en").slice(0, 2);
  const dark = opts.dark ?? (typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const alive = () => !!(map as unknown as { _container?: unknown })._container;
  if (!hasOfflineHint()) {
    const added = networkTiles(L, map);
    void import("../../map/offlineLayer")
      .then(async (m) => {
        if (!alive()) return;
        const { activeOfflineMap } = await import("../../map/offlineStore");
        if (!(await activeOfflineMap().catch(() => null)) || !alive()) return;
        map.eachLayer((l) => {
          if (typeof (l as Leaflet.TileLayer).getTileUrl === "function") map.removeLayer(l);
        });
        await m.addOfflineBasemap(L, map, { lang, dark });
      })
      .catch(() => undefined);
    return added;
  }
  const fallback = () => {
    if (alive()) networkTiles(L, map);
  };
  void import("../../map/offlineLayer")
    .then((m) => (alive() ? m.addOfflineBasemap(L, map, { lang, dark }) : true))
    .then((added) => {
      if (!added) fallback();
    })
    .catch(fallback);
  return true;
}
