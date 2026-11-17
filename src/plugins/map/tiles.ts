/**
 * The map's background (plans W12.F7, W13.G3; audit r4 A3 #6). Every map
 * (the ```map block, the database map view and the GeoJSON/GPX viewer) adds
 * it through here, local first:
 *
 * 1. an offline basemap in the vault (`.lumen/maps/*.pmtiles`, W13.G3) when
 *    there is one — drawn from the file, no tile server is ever asked, in
 *    airplane mode or not, labels in the UI's language. The vault is always
 *    looked in first;
 * 2. else the OpenStreetMap tiles — the one network request a map makes —
 *    only once the user has allowed them (src/privacy/mapTiles.ts: off by
 *    default, because the tiles tell the server which area is viewed), and
 *    never in airplane mode;
 * 3. else no background: the shapes and markers, which are local, still
 *    show, with a "Load map tiles" button on the map that asks for the
 *    consent (and, once given, a button that takes it back).
 */
import type * as Leaflet from "leaflet";
import { t } from "../../i18n";
import { airplaneModeOn } from "../../privacy/airplane";
import { MAP_TILES_EVENT, onlineTilesAllowed, setOnlineTilesAllowed } from "../../privacy/mapTiles";

export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
/** Kept in step with src/map/offlineStore.ts (OFFLINE_FLAG): set while a basemap is in the vault. */
const OFFLINE_FLAG = "lumen.map.offline";

const isNetworkLayer = (l: unknown) => typeof (l as Leaflet.TileLayer).getTileUrl === "function";

/** Maps that have the online layer now (one layer per map, however many paths add it). */
const online = new WeakMap<object, Leaflet.Layer>();

function networkTiles(L: typeof Leaflet, map: Leaflet.Map): boolean {
  if (airplaneModeOn() || !onlineTilesAllowed()) return false;
  if (online.has(map)) return true;
  // privacy-ledger: map tiles are image loads from tile.openstreetmap.org (no note content is sent; the tile coordinates reveal the area viewed). Only after the user allowed them (src/privacy/mapTiles.ts), off in airplane mode, and never used while an offline basemap is in the vault.
  online.set(map, L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map));
  return true;
}

function removeNetworkTiles(map: Leaflet.Map): void {
  map.eachLayer((l) => void (isNetworkLayer(l) && map.removeLayer(l)));
  online.delete(map);
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
 * The consent button, in a corner of the map (a plain button, so the
 * keyboard and screen readers reach it): "Load map tiles" while there are
 * none, "Stop online tiles" while they show. Nothing in airplane mode.
 */
function consentControl(L: typeof Leaflet, map: Leaflet.Map): void {
  const host = (map as { getContainer?: () => HTMLElement }).getContainer?.();
  if (!host || typeof document === "undefined" || airplaneModeOn()) return;
  host.querySelector(".lumen-map-tiles-consent")?.remove();
  const box = document.createElement("div");
  box.className = "lumen-map-tiles-consent";
  box.style.cssText = "position:absolute;inset-block-end:8px;inset-inline-start:8px;z-index:1000;max-inline-size:min(320px,80%);display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:6px;background:hsl(var(--bg) / 0.92);color:hsl(var(--fg));border:1px solid hsl(var(--border));font-size:12px;";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.dataset.testid = "map-tiles-consent";
  const note = document.createElement("span");
  note.style.color = "hsl(var(--fg-muted))";
  const render = () => {
    const on = onlineTilesAllowed();
    button.textContent = on ? t("map.tiles.stop") : t("map.tiles.allow");
    button.setAttribute("aria-pressed", String(on));
    note.textContent = on ? "" : t("map.tiles.why");
    note.hidden = on;
  };
  button.addEventListener("click", () => setOnlineTilesAllowed(!onlineTilesAllowed()));
  const onChange = () => {
    if (!host.isConnected && !(map as unknown as { _container?: unknown })._container) return window.removeEventListener(MAP_TILES_EVENT, onChange);
    const on = onlineTilesAllowed();
    if (on) networkTiles(L, map);
    else removeNetworkTiles(map);
    render();
  };
  window.addEventListener(MAP_TILES_EVENT, onChange);
  (map as { on?: (e: string, f: () => void) => void }).on?.("unload", () => window.removeEventListener(MAP_TILES_EVENT, onChange));
  // Keep map gestures from starting on the button.
  for (const ev of ["pointerdown", "mousedown", "dblclick", "wheel", "touchstart"]) box.addEventListener(ev, (e) => e.stopPropagation());
  // The map's strings load with the button: tiles.ts is reached statically from three views, so it does not pull
  // the lazy English into their chunks (i18nLazyEnglish).
  void import("../../map/offlineMapStrings").then(() => {
    render();
    box.append(button, note);
    host.append(box);
  });
}

/**
 * Add the background. The vault's offline basemap is looked for first and,
 * when there is one, it is the background (no network). Without one, the
 * online tiles come only with the user's consent, else the map shows the
 * consent button. Returns false only when no background can come (airplane
 * mode and no offline basemap known), so the caller can say why.
 */
export function addBaseTiles(L: typeof Leaflet, map: Leaflet.Map, opts: { lang?: string; dark?: boolean } = {}): boolean {
  const lang = opts.lang ?? ((typeof document !== "undefined" && document.documentElement.lang) || "en").slice(0, 2);
  const dark = opts.dark ?? (typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const alive = () => !!(map as unknown as { _container?: unknown })._container;
  const noBasemap = () => {
    if (!alive()) return;
    networkTiles(L, map);
    consentControl(L, map);
  };
  void import("../../map/offlineLayer")
    .then((m) => (alive() ? m.addOfflineBasemap(L, map, { lang, dark }) : true))
    .then((added) => {
      if (!added) noBasemap();
    })
    .catch(noBasemap);
  return hasOfflineHint() || !airplaneModeOn();
}
