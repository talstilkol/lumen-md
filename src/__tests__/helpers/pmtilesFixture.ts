/**
 * Test fixtures for the offline map (W13.G3): a PMTiles v3 writer and an
 * MVT encoder, written from the public specs, so the reader and renderer
 * are tested on archives built here (no file is downloaded).
 */
import { zxyToTileId } from "../../map/pmtiles";

const enc = new TextEncoder();

export function varint(n: number, out: number[]) {
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

export interface FixtureEntry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

export function encodeDirectory(entries: readonly FixtureEntry[]): Uint8Array {
  const out: number[] = [];
  varint(entries.length, out);
  let last = 0;
  for (const e of entries) {
    varint(e.tileId - last, out);
    last = e.tileId;
  }
  for (const e of entries) varint(e.runLength, out);
  for (const e of entries) varint(e.length, out);
  entries.forEach((e, i) => varint(i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1, out));
  return Uint8Array.from(out);
}

export async function gzip(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export interface ArchiveOptions {
  tileType?: number;
  gzipDirs?: boolean;
  /** Put every entry in one leaf directory (the root points at it). */
  leaf?: boolean;
  metadata?: Record<string, unknown>;
  bounds?: [number, number, number, number];
}

/** A PMTiles v3 archive of these tiles ("z/x/y" → bytes, uncompressed). */
export async function buildArchive(tiles: ReadonlyMap<string, Uint8Array>, o: ArchiveOptions = {}): Promise<Uint8Array> {
  const list = [...tiles].map(([k, data]) => {
    const [z, x, y] = k.split("/").map(Number);
    return { id: zxyToTileId(z, x, y), z, data };
  });
  list.sort((a, b) => a.id - b.id);
  const data: number[] = [];
  const entries: FixtureEntry[] = list.map((t) => {
    const e = { tileId: t.id, offset: data.length, length: t.data.length, runLength: 1 };
    data.push(...t.data);
    return e;
  });
  const pack = async (b: Uint8Array) => (o.gzipDirs ? gzip(b) : b);
  let root: Uint8Array;
  let leaves: Uint8Array = new Uint8Array(0);
  if (o.leaf) {
    leaves = await pack(encodeDirectory(entries));
    root = await pack(encodeDirectory([{ tileId: entries[0]?.tileId ?? 0, offset: 0, length: leaves.length, runLength: 0 }]));
  } else root = await pack(encodeDirectory(entries));
  const meta = await pack(enc.encode(JSON.stringify(o.metadata ?? {})));
  const H = 127;
  const rootOff = H;
  const metaOff = rootOff + root.length;
  const leafOff = metaOff + meta.length;
  const dataOff = leafOff + leaves.length;
  const out = new Uint8Array(dataOff + data.length);
  const v = new DataView(out.buffer);
  out.set(enc.encode("PMTiles"), 0);
  out[7] = 3;
  const u64 = (at: number, n: number) => {
    v.setUint32(at, n % 2 ** 32, true);
    v.setUint32(at + 4, Math.floor(n / 2 ** 32), true);
  };
  u64(8, rootOff);
  u64(16, root.length);
  u64(24, metaOff);
  u64(32, meta.length);
  u64(40, leafOff);
  u64(48, leaves.length);
  u64(56, dataOff);
  u64(64, data.length);
  u64(72, list.length);
  u64(80, entries.length);
  u64(88, entries.length);
  out[96] = 1;
  out[97] = o.gzipDirs ? 2 : 1;
  out[98] = 1;
  out[99] = o.tileType ?? 1;
  out[100] = Math.min(...list.map((t) => t.z));
  out[101] = Math.max(...list.map((t) => t.z));
  const [w, s, e, n] = o.bounds ?? [34.2, 29.4, 35.9, 33.4];
  v.setInt32(102, Math.round(w * 1e7), true);
  v.setInt32(106, Math.round(s * 1e7), true);
  v.setInt32(110, Math.round(e * 1e7), true);
  v.setInt32(114, Math.round(n * 1e7), true);
  out[118] = out[100];
  v.setInt32(119, Math.round(((w + e) / 2) * 1e7), true);
  v.setInt32(123, Math.round(((s + n) / 2) * 1e7), true);
  out.set(root, rootOff);
  out.set(meta, metaOff);
  out.set(leaves, leafOff);
  out.set(Uint8Array.from(data), dataOff);
  return out;
}

/* ─── MVT encoding ─── */

const zz = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
function field(n: number, wire: number, out: number[]) {
  varint(n * 8 + wire, out);
}
function bytesField(n: number, b: ArrayLike<number>, out: number[]) {
  field(n, 2, out);
  varint(b.length, out);
  for (let i = 0; i < b.length; i++) out.push(b[i]);
}

export interface FixtureFeature {
  type: 1 | 2 | 3;
  /** Parts: flat [x, y, …] in tile units. */
  parts: number[][];
  props: Record<string, string | number | boolean>;
}

function geometry(type: number, parts: number[][]): number[] {
  const cmds: number[] = [];
  let x = 0;
  let y = 0;
  for (const p of parts) {
    const n = p.length / 2 - (type === 3 ? 1 : 0); // a polygon's closing point is ClosePath
    cmds.push((1 & 7) | (1 << 3), zz(p[0] - x), zz(p[1] - y));
    x = p[0];
    y = p[1];
    if (n > 1) {
      cmds.push((2 & 7) | ((n - 1) << 3));
      for (let i = 1; i < n; i++) {
        cmds.push(zz(p[2 * i] - x), zz(p[2 * i + 1] - y));
        x = p[2 * i];
        y = p[2 * i + 1];
      }
    }
    if (type === 3) cmds.push(7 | (1 << 3));
  }
  return cmds;
}

export function encodeTile(layers: Record<string, FixtureFeature[]>, extent = 4096): Uint8Array {
  const tile: number[] = [];
  for (const [name, feats] of Object.entries(layers)) {
    const keys: string[] = [];
    const values: Array<string | number | boolean> = [];
    const layer: number[] = [];
    bytesField(1, enc.encode(name), layer);
    for (const f of feats) {
      const tags: number[] = [];
      for (const [k, v] of Object.entries(f.props)) {
        let ki = keys.indexOf(k);
        if (ki < 0) ki = keys.push(k) - 1;
        let vi = values.indexOf(v);
        if (vi < 0) vi = values.push(v) - 1;
        tags.push(ki, vi);
      }
      const feat: number[] = [];
      const packed = (n: number, arr: number[]) => {
        const b: number[] = [];
        for (const a of arr) varint(a, b);
        bytesField(n, b, feat);
      };
      packed(2, tags);
      field(3, 0, feat);
      varint(f.type, feat);
      packed(4, geometry(f.type, f.parts));
      bytesField(2, feat, layer);
    }
    for (const k of keys) bytesField(3, enc.encode(k), layer);
    for (const v of values) {
      const val: number[] = [];
      if (typeof v === "string") bytesField(1, enc.encode(v), val);
      else if (typeof v === "boolean") {
        field(7, 0, val);
        varint(v ? 1 : 0, val);
      } else if (Number.isInteger(v) && v >= 0) {
        field(5, 0, val);
        varint(v, val);
      } else {
        field(3, 1, val);
        const d = new Uint8Array(8);
        new DataView(d.buffer).setFloat64(0, v, true);
        val.push(...d);
      }
      bytesField(4, val, layer);
    }
    field(5, 0, layer);
    varint(extent, layer);
    field(15, 0, layer);
    varint(2, layer);
    bytesField(3, layer, tile);
  }
  return Uint8Array.from(tile);
}

/** A small Israel-ish basemap tile: land, the sea in the west, a highway, three places in three languages. */
export function israelTile(): Uint8Array {
  const E = 4096;
  return encodeTile({
    earth: [{ type: 3, parts: [[0, 0, E, 0, E, E, 0, E, 0, 0]], props: { kind: "earth" } }],
    water: [{ type: 3, parts: [[0, 0, 1100, 0, 900, E, 0, E, 0, 0]], props: { kind: "ocean" } }],
    landuse: [{ type: 3, parts: [[2600, 2600, 3200, 2600, 3200, 3200, 2600, 3200, 2600, 2600]], props: { kind: "park" } }],
    roads: [{ type: 2, parts: [[1300, 300, 1800, 1500, 2400, 2700, 2900, 3900]], props: { kind: "highway", ref: "1" } }],
    places: [
      { type: 1, parts: [[1500, 1400]], props: { kind: "locality", name: "תל אביב-יפו", "name:he": "תל אביב-יפו", "name:en": "Tel Aviv-Yafo", "name:ar": "تل أبيب - يافا", min_zoom: 4 } },
      { type: 1, parts: [[2900, 2200]], props: { kind: "locality", name: "ירושלים", "name:he": "ירושלים", "name:en": "Jerusalem", "name:ar": "القدس", min_zoom: 3 } },
      { type: 1, parts: [[1700, 500]], props: { kind: "locality", name: "חיפה", "name:en": "Haifa", min_zoom: 5 } },
      { type: 1, parts: [[3300, 3700]], props: { kind: "locality", name: "באר שבע 2", "name:en": "Be'er Sheva", min_zoom: 6, population: 209000 } },
    ],
  });
}
