/**
 * GeoJSON (RFC 7946) and GPX 1.1 (https://www.topografix.com/GPX/1/1/) for
 * the map viewer, plan W12.F7. GPX is turned into GeoJSON: waypoints become
 * points, each track segment and each route a line. Pure, no dependencies;
 * XML is parsed inert.
 */
import { parseInertDocument } from "../lib/trustedTypes";

export interface GeoFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

export interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export class GeoFileError extends Error {}

const GEOMETRY = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"]);

/** A GeoJSON text as a FeatureCollection (a bare geometry or feature is wrapped). */
export function parseGeoJson(text: string): GeoCollection {
  let v: { type?: string; features?: unknown[]; geometry?: unknown };
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new GeoFileError(`not JSON: ${(e as Error).message}`);
  }
  if (v?.type === "FeatureCollection" && Array.isArray(v.features)) return { type: "FeatureCollection", features: v.features as GeoFeature[] };
  if (v?.type === "Feature") return { type: "FeatureCollection", features: [v as unknown as GeoFeature] };
  if (v?.type && GEOMETRY.has(v.type)) return { type: "FeatureCollection", features: [{ type: "Feature", geometry: v as GeoFeature["geometry"], properties: {} }] };
  throw new GeoFileError("not GeoJSON (no FeatureCollection, Feature or geometry)");
}

const num = (s: string | null) => (s === null || s.trim() === "" ? NaN : Number(s));
const child = (el: Element, name: string) => Array.from(el.children).find((c) => c.localName === name);
const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const text = (el: Element, name: string) => child(el, name)?.textContent?.trim() || undefined;

/** [lng, lat] or [lng, lat, ele] from a wpt/trkpt/rtept, or null when its coordinates are not numbers in range. */
function position(pt: Element): number[] | null {
  const lat = num(pt.getAttribute("lat"));
  const lon = num(pt.getAttribute("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const ele = num(text(pt, "ele") ?? null);
  return Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat];
}

/** GPX 1.0/1.1 → GeoJSON. Waypoints are points; each track segment and each route is a line. */
export function gpxToGeoJson(xml: string): GeoCollection {
  const doc = parseInertDocument(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "gpx" || doc.getElementsByTagName("parsererror").length) throw new GeoFileError("not a GPX file");
  const features: GeoFeature[] = [];
  for (const w of kids(root, "wpt")) {
    const p = position(w);
    if (p) features.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { kind: "waypoint", name: text(w, "name"), desc: text(w, "desc"), time: text(w, "time") } });
  }
  for (const trk of kids(root, "trk")) {
    const name = text(trk, "name");
    kids(trk, "trkseg").forEach((seg, i, all) => {
      const line = kids(seg, "trkpt").map(position).filter((p): p is number[] => !!p);
      if (line.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { kind: "track", name: all.length > 1 && name ? `${name} (${i + 1})` : name, points: line.length } });
    });
  }
  for (const rte of kids(root, "rte")) {
    const line = kids(rte, "rtept").map(position).filter((p): p is number[] => !!p);
    if (line.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { kind: "route", name: text(rte, "name"), points: line.length } });
  }
  return { type: "FeatureCollection", features };
}

export function parseGeoFile(path: string, content: string): GeoCollection {
  return /\.gpx$/i.test(path) ? gpxToGeoJson(content) : parseGeoJson(content);
}

/** Great-circle length of a line in kilometres (haversine, mean Earth radius). */
export function lineLengthKm(coords: number[][]): number {
  const R = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    km += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return km;
}

/** One row per feature for the table that stands beside the map. */
export function featureRows(c: GeoCollection): { name: string; type: string; detail: string }[] {
  return c.features.map((f, i) => {
    const g = f.geometry;
    const name = String(f.properties?.name ?? f.properties?.title ?? `#${i + 1}`);
    if (g?.type === "Point") {
      const [lng, lat] = g.coordinates as number[];
      return { name, type: String(f.properties?.kind ?? "Point"), detail: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    }
    if (g?.type === "LineString") {
      const coords = g.coordinates as number[][];
      return { name, type: String(f.properties?.kind ?? "LineString"), detail: `${lineLengthKm(coords).toFixed(2)} km · ${coords.length}` };
    }
    return { name, type: g?.type ?? "?", detail: "" };
  });
}
