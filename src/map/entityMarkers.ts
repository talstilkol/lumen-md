/**
 * The vault's entities on the map (plan W13.G3): every entity note with a
 * location (`location: 31.77, 35.21`, or `coordinates:` / `coords:` /
 * `מיקום:`) as a marker, clustered so a thousand places stay readable;
 * a cluster zooms in on click and names its count for screen readers.
 */
import type * as Leaflet from "leaflet";
import { clusterPoints, parseLocation, type GeoPoint } from "./cluster";

const KEYS = ["location", "coordinates", "coords", "מיקום"];

/** Entities with a location, from entity notes (path → text). */
export async function entityPoints(files: ReadonlyMap<string, string>): Promise<GeoPoint[]> {
  const { splitFrontmatter } = await import("../entities/frontmatter");
  const { parseEntityNote } = await import("../entities/notes");
  const out: GeoPoint[] = [];
  for (const [path, text] of files) {
    if (!path.endsWith(".md")) continue;
    const e = parseEntityNote(path, text);
    if (!e) continue;
    const { props } = splitFrontmatter(text);
    const at = KEYS.map((k) => parseLocation(props[k])).find((x) => x !== null);
    if (at) out.push({ lat: at[0], lng: at[1], id: e.id, label: e.name });
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Add the clustered entity markers; they regroup on every zoom. */
export async function addEntityMarkers(L: typeof Leaflet, map: Leaflet.Map, opts: { fit?: boolean; files?: ReadonlyMap<string, string> } = {}): Promise<number> {
  const files = opts.files ?? (await (await import("../entities/vaultIo")).loadEntityFiles());
  const points = await entityPoints(files);
  const group = L.layerGroup().addTo(map);
  const draw = () => {
    group.clearLayers();
    for (const c of clusterPoints(points, map.getZoom())) {
      if (c.points.length === 1) {
        const p = c.points[0];
        L.marker([p.lat, p.lng], { title: p.label, alt: p.label }).bindPopup(`<span dir="auto">${esc(p.label)}</span>`).addTo(group);
      } else {
        const names = c.points.slice(0, 5).map((p) => p.label).join(", ");
        const icon = L.divIcon({ className: "lumen-map-cluster", html: `<span style="display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:hsl(212 80% 42%);color:#fff;font:600 12px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">${c.points.length}</span>`, iconSize: [32, 32] });
        L.marker([c.lat, c.lng], { icon, title: `${c.points.length}: ${names}`, alt: `${c.points.length}: ${names}`, keyboard: true })
          .on("click", () => map.setView([c.lat, c.lng], Math.min(map.getMaxZoom() || 18, map.getZoom() + 2)))
          .addTo(group);
      }
    }
  };
  draw();
  map.on("zoomend", draw);
  if (opts.fit && points.length) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [24, 24], maxZoom: 13 });
  return points.length;
}
