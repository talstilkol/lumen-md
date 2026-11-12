/**
 * Remove what a photo says about where and when it was taken, and on what,
 * before it goes into a note (plan W5.11, journalist mode).
 *
 * Cameras and phones write EXIF (GPS position, time, camera serial number,
 * owner name), XMP, IPTC and text chunks into JPEG, PNG and WebP files. All
 * of it is removed; the pixels are not touched (no re-encoding, no quality
 * loss). What is kept:
 *   - JPEG: JFIF (APP0), the ICC colour profile (APP2), Adobe's colour
 *     transform (APP14), and the EXIF orientation — rewritten as an EXIF
 *     block holding that one tag, so a portrait photo still stands upright;
 *   - PNG: every chunk but eXIf, tEXt, zTXt, iTXt and tIME;
 *   - WebP: every chunk but EXIF and XMP (the VP8X flags are corrected).
 * Other formats (GIF, SVG, HEIC, AVIF) come back unchanged, with
 * `supported: false`.
 */

export interface StripResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** Image format that was cleaned, or null when it is not one we clean. */
  format: "jpeg" | "png" | "webp" | null;
  /** What was taken out, e.g. ["EXIF", "GPS", "XMP"]. Empty when nothing was there. */
  removed: string[];
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** Does this EXIF (TIFF) block have a GPS sub-IFD, and which orientation does it give? */
function readExif(tiff: Uint8Array): { gps: boolean; orientation: number | null } {
  if (tiff.length < 8) return { gps: false, orientation: null };
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return { gps: false, orientation: null };
  const u16 = (o: number) => (le ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1]);
  const u32 = (o: number) => (le ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16)) + tiff[o + 3] * 0x1000000 : tiff[o] * 0x1000000 + ((tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]));
  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return { gps: false, orientation: null };
  const count = u16(ifd0);
  let gps = false;
  let orientation: number | null = null;
  for (let i = 0; i < count; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > tiff.length) break;
    const tag = u16(e);
    if (tag === 0x8825) gps = true;
    if (tag === 0x0112) orientation = u16(e + 8);
  }
  return { gps, orientation };
}

/** A minimal EXIF APP1 segment holding only the Orientation tag. */
function orientationSegment(orientation: number): Uint8Array {
  const body = [
    ...[0x45, 0x78, 0x69, 0x66, 0, 0], // "Exif\0\0"
    ...[0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8], // big-endian TIFF, IFD0 at 8
    ...[0, 1], // one entry
    ...[0x01, 0x12, 0, 3, 0, 0, 0, 1, (orientation >> 8) & 0xff, orientation & 0xff, 0, 0], // Orientation, SHORT, 1
    ...[0, 0, 0, 0], // no next IFD
  ];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...body]);
}

function stripJpeg(b: Uint8Array): StripResult | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  const removed = new Set<string>();
  let orientation: number | null = null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null; // not a well-formed marker: leave the file alone
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end: the rest is image data
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    const seg = b.subarray(i, i + 2 + len);
    const data = b.subarray(i + 4, i + 2 + len);
    let keep = true;
    if (marker === 0xe1) {
      keep = false;
      if (ascii(data, 0, 6) === "Exif\0\0") {
        removed.add("EXIF");
        const ex = readExif(data.subarray(6));
        if (ex.gps) removed.add("GPS");
        if (ex.orientation && ex.orientation !== 1) orientation = ex.orientation;
      } else if (ascii(data, 0, 28) === "http://ns.adobe.com/xap/1.0/") removed.add("XMP");
      else removed.add("APP1");
    } else if (marker === 0xed) {
      keep = false;
      removed.add("IPTC");
    } else if (marker === 0xfe) {
      keep = false;
      removed.add("comment");
    } else if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) {
      keep = false; // APP3–APP13, APP15: maker notes, Photoshop, FlashPix …
      removed.add(`APP${marker - 0xe0}`);
    }
    if (keep) parts.push(seg);
    i += 2 + len;
  }
  if (orientation) parts.splice(1, 0, orientationSegment(orientation));
  parts.push(b.subarray(i));
  return { bytes: concat(parts), format: "jpeg", removed: [...removed] };
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP: Record<string, string> = { eXIf: "EXIF", tEXt: "text", zTXt: "text", iTXt: "text", tIME: "time" };

function stripPng(b: Uint8Array): StripResult | null {
  if (b.length < 8 || PNG_SIG.some((v, k) => b[k] !== v)) return null;
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  const removed = new Set<string>();
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return null;
    const what = PNG_DROP[type];
    if (what) {
      removed.add(what);
      if (type === "eXIf" && readExif(b.subarray(i + 8, i + 8 + len)).gps) removed.add("GPS");
      if (type === "iTXt" && /XML:com\.adobe\.xmp/.test(ascii(b, i + 8, Math.min(len, 32)))) removed.add("XMP");
    } else parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return { bytes: concat(parts), format: "png", removed: [...removed] };
}

function stripWebp(b: Uint8Array): StripResult | null {
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const parts: Uint8Array[] = [];
  const removed = new Set<string>();
  let vp8x: Uint8Array | null = null;
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    const end = i + 8 + len + (len & 1);
    if (end > b.length + 1) return null;
    if (type === "EXIF") {
      removed.add("EXIF");
      const data = b.subarray(i + 8, i + 8 + len);
      const tiff = ascii(data, 0, 6) === "Exif\0\0" ? data.subarray(6) : data;
      if (readExif(tiff).gps) removed.add("GPS");
    } else if (type === "XMP ") removed.add("XMP");
    else {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (type === "VP8X") vp8x = chunk;
      parts.push(chunk);
    }
    i = end;
  }
  // VP8X flags: bit 3 EXIF, bit 2 XMP.
  if (vp8x && vp8x.length > 8) vp8x[8] &= ~0x0c;
  const body = concat(parts);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  const size = body.length + 4;
  head[4] = size & 0xff;
  head[5] = (size >> 8) & 0xff;
  head[6] = (size >> 16) & 0xff;
  head[7] = (size >>> 24) & 0xff;
  return { bytes: concat([head, body]), format: "webp", removed: [...removed] };
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Remove location, time, device and text metadata from a JPEG, PNG or WebP. */
export function stripImageMetadata(bytes: Uint8Array): StripResult {
  const r = stripJpeg(bytes) ?? stripPng(bytes) ?? stripWebp(bytes);
  if (r) return r;
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return { bytes: copy, format: null, removed: [] };
}

/** Does the image carry a GPS position? (JPEG, PNG and WebP EXIF.) */
export function hasGps(bytes: Uint8Array): boolean {
  return stripImageMetadata(bytes).removed.includes("GPS");
}

/** localStorage key: "1" keeps photos' metadata (the default removes it). */
export const KEEP_METADATA_KEY = "lumen.images.keepMetadata";

export function keepImageMetadata(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEEP_METADATA_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The file to store for an image added to a note: the same image without
 * its metadata (unless the user chose to keep it), same name and type.
 */
export async function cleanImageFile(file: File): Promise<File> {
  if (keepImageMetadata() || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const r = stripImageMetadata(new Uint8Array(await file.arrayBuffer()));
  if (!r.format || r.removed.length === 0) return file;
  return new File([r.bytes], file.name, { type: file.type, lastModified: file.lastModified });
}
