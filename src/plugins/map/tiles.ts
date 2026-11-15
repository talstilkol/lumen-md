/**
 * The map's background tiles, the one network request a map makes (plan
 * W12.F7). Every map (the ```map block, the database map view and the
 * GeoJSON/GPX viewer) adds them through here, so that in airplane mode none
 * is requested: the map is drawn without a background, and the shapes and
 * markers, which are local, still show.
 */
import type * as Leaflet from "leaflet";
import { airplaneModeOn } from "../../privacy/airplane";

export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Add the OpenStreetMap tiles unless airplane mode is on. Returns whether they were added. */
export function addBaseTiles(L: typeof Leaflet, map: Leaflet.Map): boolean {
  if (airplaneModeOn()) return false;
  // privacy-ledger: map tiles are image loads from tile.openstreetmap.org (no note content is sent; the tile coordinates reveal the area viewed). Off in airplane mode.
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
  return true;
}
