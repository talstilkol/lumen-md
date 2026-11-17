/**
 * Marker clusters (plan W13.G3): points that would overlap at this zoom
 * become one marker with a count, in the Web-Mercator pixel grid — cheap
 * enough for thousands of entities, recomputed on zoom.
 */
export interface GeoPoint {
  lat: number;
  lng: number;
  id: string;
  label: string;
}

export interface Cluster {
  lat: number;
  lng: number;
  points: GeoPoint[];
}

/** Web-Mercator world pixels at zoom z (256-pixel tiles). */
export function project(lat: number, lng: number, z: number): [number, number] {
  const s = 256 * 2 ** z;
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
}

/** Group points within `radius` pixels at zoom z (a grid, then each cell's centroid). */
export function clusterPoints(points: readonly GeoPoint[], z: number, radius = 40): Cluster[] {
  const cells = new Map<string, GeoPoint[]>();
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const [x, y] = project(p.lat, p.lng, z);
    const key = `${Math.floor(x / radius)}:${Math.floor(y / radius)}`;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(p);
  }
  return [...cells.values()].map((ps) => ({ lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lng: ps.reduce((a, p) => a + p.lng, 0) / ps.length, points: ps }));
}

/** "31.77, 35.21", "31.77,35.21", [31.77, 35.21] or { lat, lng|lon } → [lat, lng], or null. */
export function parseLocation(v: unknown): [number, number] | null {
  let lat: number | undefined;
  let lng: number | undefined;
  if (typeof v === "string") {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v);
    if (m) [lat, lng] = [Number(m[1]), Number(m[2])];
  } else if (Array.isArray(v) && v.length === 2) [lat, lng] = [Number(v[0]), Number(v[1])];
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    lat = Number(o.lat);
    lng = Number(o.lng ?? o.lon);
  }
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}
