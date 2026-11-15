/**
 * A ZIP of stored (uncompressed) files: the voice corpus export (session.ts).
 * PKWARE APPNOTE 6.3.10: a local header + data per file, then the central
 * directory and its end record. UTF-8 names (flag bit 11). ZIP64 is not
 * written, so the whole archive must stay under 4 GiB (two hours of 22 kHz
 * 16-bit mono is about 320 MB).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Files (path → bytes, in order) as one stored ZIP. A fixed date (1980-01-01): the same files give the same bytes. */
export function storedZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const entries = [...files].map(([path, data]) => ({ name: enc.encode(path), data, crc: crc32(data), offset: 0 }));
  const size = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length + 46 + e.name.length, 22);
  if (size > 0xffffffff) throw new Error("zip: over 4 GiB (no ZIP64)");
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let o = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  for (const e of entries) {
    e.offset = o;
    v.setUint32(o, 0x04034b50, true);
    v.setUint16(o + 4, 20, true); // version needed: 2.0
    v.setUint16(o + 6, 0x0800, true); // UTF-8 names
    v.setUint16(o + 8, 0, true); // stored
    v.setUint16(o + 10, 0, true);
    v.setUint16(o + 12, DOS_DATE, true);
    v.setUint32(o + 14, e.crc, true);
    v.setUint32(o + 18, e.data.length, true);
    v.setUint32(o + 22, e.data.length, true);
    v.setUint16(o + 26, e.name.length, true);
    v.setUint16(o + 28, 0, true);
    out.set(e.name, o + 30);
    out.set(e.data, o + 30 + e.name.length);
    o += 30 + e.name.length + e.data.length;
  }
  const cd = o;
  for (const e of entries) {
    v.setUint32(o, 0x02014b50, true);
    v.setUint16(o + 4, 20, true);
    v.setUint16(o + 6, 20, true);
    v.setUint16(o + 8, 0x0800, true);
    v.setUint16(o + 10, 0, true);
    v.setUint16(o + 12, 0, true);
    v.setUint16(o + 14, DOS_DATE, true);
    v.setUint32(o + 16, e.crc, true);
    v.setUint32(o + 20, e.data.length, true);
    v.setUint32(o + 24, e.data.length, true);
    v.setUint16(o + 28, e.name.length, true);
    v.setUint16(o + 30, 0, true);
    v.setUint16(o + 32, 0, true);
    v.setUint16(o + 34, 0, true);
    v.setUint16(o + 36, 0, true);
    v.setUint32(o + 38, 0, true);
    v.setUint32(o + 42, e.offset, true);
    out.set(e.name, o + 46);
    o += 46 + e.name.length;
  }
  v.setUint32(o, 0x06054b50, true);
  v.setUint16(o + 8, entries.length, true);
  v.setUint16(o + 10, entries.length, true);
  v.setUint32(o + 12, o - cd, true);
  v.setUint32(o + 16, cd, true);
  return out;
}
