/**
 * A PMTiles v3 reader (plan W13.G3): one file holds a whole tile pyramid,
 * so a regional basemap (Protomaps, OSM data under ODbL) can live in the
 * vault and draw with no network at all. Written here from the public
 * format description (github.com/protomaps/PMTiles, spec v3), not copied.
 *
 * Layout: a 127-byte header; a root directory; optional leaf directories;
 * metadata (JSON); tile data. Directories are varint-encoded and usually
 * gzip-compressed; tiles are addressed by a Hilbert-curve tile id.
 *
 * The source is anything that can read a byte range — a File / Blob from
 * OPFS (`blob.slice`), or an ArrayBuffer in tests. Nothing is fetched.
 */

export const enum Compression {
  Unknown = 0,
  None = 1,
  Gzip = 2,
  Brotli = 3,
  Zstd = 4,
}

export const enum TileType {
  Unknown = 0,
  Mvt = 1,
  Png = 2,
  Jpeg = 3,
  Webp = 4,
  Avif = 5,
}

export interface Header {
  rootDirectoryOffset: number;
  rootDirectoryLength: number;
  metadataOffset: number;
  metadataLength: number;
  leafDirectoryOffset: number;
  leafDirectoryLength: number;
  tileDataOffset: number;
  tileDataLength: number;
  numAddressedTiles: number;
  numTileEntries: number;
  numTileContents: number;
  clustered: boolean;
  internalCompression: Compression;
  tileCompression: Compression;
  tileType: TileType;
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  centerZoom: number;
  centerLon: number;
  centerLat: number;
}

export interface Entry {
  tileId: number;
  offset: number;
  length: number;
  /** 0: a leaf directory; n: this tile and the next n − 1 ids share the data. */
  runLength: number;
}

export type RangeSource = (offset: number, length: number) => Promise<Uint8Array>;

export const HEADER_BYTES = 127;

/** A Blob (an OPFS File) as a range source. */
export const blobSource =
  (blob: Blob): RangeSource =>
  async (offset, length) =>
    new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());

/** Bytes in memory as a range source. */
export const bytesSource =
  (bytes: Uint8Array): RangeSource =>
  async (offset, length) =>
    bytes.subarray(offset, offset + length);

const u64 = (v: DataView, o: number) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 2 ** 32;

export function parseHeader(b: Uint8Array): Header {
  if (b.length < HEADER_BYTES) throw new Error("pmtiles: the file is too short");
  if (String.fromCharCode(...b.subarray(0, 7)) !== "PMTiles") throw new Error("pmtiles: not a PMTiles file");
  if (b[7] !== 3) throw new Error(`pmtiles: version ${b[7]} (only 3 is read)`);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    rootDirectoryOffset: u64(v, 8),
    rootDirectoryLength: u64(v, 16),
    metadataOffset: u64(v, 24),
    metadataLength: u64(v, 32),
    leafDirectoryOffset: u64(v, 40),
    leafDirectoryLength: u64(v, 48),
    tileDataOffset: u64(v, 56),
    tileDataLength: u64(v, 64),
    numAddressedTiles: u64(v, 72),
    numTileEntries: u64(v, 80),
    numTileContents: u64(v, 88),
    clustered: b[96] === 1,
    internalCompression: b[97],
    tileCompression: b[98],
    tileType: b[99],
    minZoom: b[100],
    maxZoom: b[101],
    minLon: v.getInt32(102, true) / 1e7,
    minLat: v.getInt32(106, true) / 1e7,
    maxLon: v.getInt32(110, true) / 1e7,
    maxLat: v.getInt32(114, true) / 1e7,
    centerZoom: b[118],
    centerLon: v.getInt32(119, true) / 1e7,
    centerLat: v.getInt32(123, true) / 1e7,
  };
}

/** Unsigned LEB128 varint at `pos` (values up to 2^53). */
export function readVarint(b: Uint8Array, pos: { i: number }): number {
  let value = 0;
  let mul = 1;
  for (let k = 0; k < 10; k++) {
    if (pos.i >= b.length) throw new Error("pmtiles: truncated varint");
    const byte = b[pos.i++];
    value += (byte & 0x7f) * mul;
    if (byte < 0x80) return value;
    mul *= 128;
  }
  throw new Error("pmtiles: varint too long");
}

/** The directory's entries (decompressed bytes). */
export function parseDirectory(b: Uint8Array): Entry[] {
  const pos = { i: 0 };
  const n = readVarint(b, pos);
  const entries: Entry[] = Array.from({ length: n }, () => ({ tileId: 0, offset: 0, length: 0, runLength: 0 }));
  let last = 0;
  for (let k = 0; k < n; k++) entries[k].tileId = last += readVarint(b, pos);
  for (let k = 0; k < n; k++) entries[k].runLength = readVarint(b, pos);
  for (let k = 0; k < n; k++) entries[k].length = readVarint(b, pos);
  for (let k = 0; k < n; k++) {
    const v = readVarint(b, pos);
    entries[k].offset = v === 0 && k > 0 ? entries[k - 1].offset + entries[k - 1].length : v - 1;
  }
  return entries;
}

/** Tiles before zoom z: 1 + 4 + … + 4^(z−1). */
const zoomBase = (z: number) => (4 ** z - 1) / 3;

/** The Hilbert-curve tile id of z/x/y. */
export function zxyToTileId(z: number, x: number, y: number): number {
  if (z > 26) throw new RangeError("pmtiles: zoom above 26");
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) throw new RangeError(`pmtiles: tile ${z}/${x}/${y} is outside the world`);
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // Rotate the quadrant (only the bits below s matter from here on).
    if (ry === 0) {
      if (rx === 1) {
        x = n - 1 - x;
        y = n - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return zoomBase(z) + d;
}

/** The z/x/y of a tile id (the inverse; for tests and the writer). */
export function tileIdToZxy(id: number): [number, number, number] {
  let z = 0;
  while (zoomBase(z + 1) <= id) z++;
  let d = id - zoomBase(z);
  const n = 2 ** z;
  let x = 0;
  let y = 0;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & Math.floor(d / 2);
    const ry = 1 & (d ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
    x += s * rx;
    y += s * ry;
    d = Math.floor(d / 4);
  }
  return [z, x, y];
}

/** The entry for a tile id: the last one at or before it (binary search). */
export function findEntry(entries: readonly Entry[], tileId: number): Entry | null {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = entries[mid].tileId - tileId;
    if (c < 0) lo = mid + 1;
    else if (c > 0) hi = mid - 1;
    else return entries[mid];
  }
  if (hi >= 0) {
    const e = entries[hi];
    if (e.runLength === 0) return e; // a leaf directory covers what follows
    if (tileId - e.tileId < e.runLength) return e;
  }
  return null;
}

export async function decompress(b: Uint8Array, c: Compression): Promise<Uint8Array> {
  if (c === Compression.None || c === Compression.Unknown) return b;
  if (c === Compression.Gzip) {
    if (typeof DecompressionStream === "undefined") throw new Error("pmtiles: this browser cannot unzip (no DecompressionStream)");
    const stream = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error(`pmtiles: compression ${c} is not supported here (gzip or none)`);
}

/** One archive: the header and root directory read once, leaf directories cached. */
export class PMTiles {
  private header: Promise<Header>;
  private root: Promise<Entry[]>;
  private leaves = new Map<string, Promise<Entry[]>>();

  constructor(private readonly read: RangeSource) {
    this.header = read(0, 16_384).then((b) => parseHeader(b.subarray(0, Math.max(HEADER_BYTES, Math.min(b.length, 16_384)))));
    this.root = this.header.then(async (h) => parseDirectory(await decompress(await read(h.rootDirectoryOffset, h.rootDirectoryLength), h.internalCompression)));
  }

  getHeader(): Promise<Header> {
    return this.header;
  }

  async getMetadata(): Promise<Record<string, unknown>> {
    const h = await this.header;
    if (!h.metadataLength) return {};
    const text = new TextDecoder().decode(await decompress(await this.read(h.metadataOffset, h.metadataLength), h.internalCompression));
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      // why: broken metadata does not stop the tiles from drawing
      return {};
    }
  }

  /** The tile's bytes (decompressed), or null when the archive has none there. */
  async getTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const h = await this.header;
    if (z < h.minZoom || z > h.maxZoom) return null;
    const id = zxyToTileId(z, x, y);
    let entries = await this.root;
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(entries, id);
      if (!e) return null;
      if (e.runLength > 0) return decompress(await this.read(h.tileDataOffset + e.offset, e.length), h.tileCompression);
      const key = `${e.offset}:${e.length}`;
      let leaf = this.leaves.get(key);
      if (!leaf) {
        leaf = this.read(h.leafDirectoryOffset + e.offset, e.length).then(async (b) => parseDirectory(await decompress(b, h.internalCompression)));
        if (this.leaves.size > 64) this.leaves.delete(this.leaves.keys().next().value as string);
        this.leaves.set(key, leaf);
      }
      entries = await leaf;
    }
    throw new Error("pmtiles: directories nest too deep");
  }
}
