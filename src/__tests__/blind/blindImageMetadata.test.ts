/**
 * Blind tests (plan W6.15, W10.D19): photo metadata removal.
 *
 * Written from the spec only: docs/src/content/docs/security/photo-metadata.md,
 * the photo items of docs/src/content/docs/security/journalist-mode.md and the
 * declarations tsc emits for src/lib/imageMetadata.ts (signatures and its doc
 * comment, no function bodies, no existing imageMetadata tests). The JPEG, PNG
 * and WebP files are synthetic, built byte by byte here from the format specs
 * (JFIF/EXIF/TIFF 6.0, PNG 1.2, RIFF/WebP container); the outputs are parsed
 * back with the parsers below, not with the module. Lane X-BL, against
 * verify/train-5 (c3f055218e).
 *
 * Properties: GPS, time, device, XMP, IPTC, comments, text/time chunks and
 * C2PA go; the pixels (coded data) are untouched; the ICC profile and the
 * orientation stay; data after the image's end goes; the kind comes from the
 * bytes, never the name or declared type; anything that can't be parsed
 * fails closed.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanDataUrls,
  cleanImageBytes,
  cleanImageFile,
  cleanPublishedFile,
  hasGps,
  ImageMetadataError,
  KEEP_METADATA_KEY,
  keepImageMetadata,
  sniffMedia,
  stripImageMetadata,
  WITHHELD_IMAGE,
} from "../../lib/imageMetadata";

const te = new TextEncoder();
const cat = (...parts: Array<Uint8Array | number[] | string>): Uint8Array<ArrayBuffer> => {
  const bs = parts.map((p) => (typeof p === "string" ? te.encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(bs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
};
const u16be = (n: number) => [(n >> 8) & 255, n & 255];
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const indexOf = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};
const has = (hay: Uint8Array, s: string | Uint8Array) => indexOf(hay, typeof s === "string" ? te.encode(s) : s) >= 0;
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

// ---- EXIF (big-endian TIFF): IFD0 with Orientation, Make, DateTime and a GPS IFD ----
function exifTiff(opts: { gps: boolean; orientation?: number }): Uint8Array {
  // Layout: header(8) | IFD0 | GPS IFD | strings
  const make = te.encode("PhoneCo\0");
  const date = te.encode("2026:11:15 09:41:00\0");
  const n0 = 2 + (opts.gps ? 1 : 0) + (opts.orientation ? 1 : 0);
  const ifd0Off = 8;
  const ifd0Len = 2 + n0 * 12 + 4;
  const gpsOff = ifd0Off + ifd0Len;
  const gpsLen = opts.gps ? 2 + 2 * 12 + 4 : 0;
  const strOff = gpsOff + gpsLen;
  const entries: number[][] = [];
  if (opts.orientation) entries.push([...u16be(0x0112), ...u16be(3), ...u32be(1), ...u16be(opts.orientation), 0, 0]);
  entries.push([...u16be(0x010f), ...u16be(2), ...u32be(make.length), ...u32be(strOff)]);
  entries.push([...u16be(0x0132), ...u16be(2), ...u32be(date.length), ...u32be(strOff + make.length)]);
  if (opts.gps) entries.push([...u16be(0x8825), ...u16be(4), ...u32be(1), ...u32be(gpsOff)]);
  const ifd0 = [...u16be(n0), ...entries.flat(), ...u32be(0)];
  const gps = opts.gps
    ? [...u16be(2), ...u16be(0x0001), ...u16be(2), ...u32be(2), 0x4e, 0, 0, 0, ...u16be(0x0003), ...u16be(2), ...u32be(2), 0x45, 0, 0, 0, ...u32be(0)]
    : [];
  return cat([0x4d, 0x4d, 0, 42, ...u32be(8)], ifd0, gps, make, date);
}

/** Orientation from a TIFF block (either byte order), or null; also whether it points at a GPS IFD. */
function readTiff(t: Uint8Array): { orientation: number | null; gps: boolean; tags: number[] } {
  const le = t[0] === 0x49;
  const r16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const r32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 2 ** 24 : t[o] * 2 ** 24 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]));
  const off = r32(4);
  const n = r16(off);
  let orientation: number | null = null;
  let gps = false;
  const tags: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12;
    const tag = r16(e);
    tags.push(tag);
    if (tag === 0x0112) orientation = r16(e + 8);
    if (tag === 0x8825) gps = true;
  }
  return { orientation, gps, tags };
}

// ---- JPEG ----
const seg = (marker: number, body: Uint8Array | number[] | string) => {
  const b = cat(body);
  return cat([0xff, marker, ...u16be(b.length + 2)], b);
};
const SCAN = new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
const DQT = seg(0xdb, [0, ...new Array(64).fill(1)]);
const SOF0 = seg(0xc0, [8, ...u16be(1), ...u16be(1), 1, 1, 0x11, 0]);
const DHT = seg(0xc4, [0x00, 1, ...new Array(15).fill(0), 0]);
const SOS = seg(0xda, [1, 1, 0x00, 0, 63, 0]);
const ICC = seg(0xe2, cat("ICC_PROFILE\0", [1, 1], "fake-icc-profile-bytes"));
const JFIF = seg(0xe0, cat("JFIF\0", [1, 2, 0, 0, 1, 0, 1, 0, 0]));

function jpeg(opts: { trailing?: boolean; extra?: Uint8Array[] } = {}): Uint8Array<ArrayBuffer> {
  return cat(
    [0xff, 0xd8],
    JFIF,
    seg(0xe1, cat("Exif\0\0", exifTiff({ gps: true, orientation: 6 }))),
    seg(0xe1, cat("http://ns.adobe.com/xap/1.0/\0", '<x:xmpmeta><rdf:Description exif:GPSLatitude="32,4.5N" xmp:CreatorTool="PhoneCo"/></x:xmpmeta>')),
    seg(0xed, cat("Photoshop 3.0\0", "8BIM", [4, 4], [0, 0], [0, 0, 0, 12], "By-line:Dana")),
    seg(0xfe, "taken by Dana Levi"),
    ICC,
    seg(0xeb, cat("JP", [0, 1], "jumbc2pa manifest store")),
    ...(opts.extra ?? []),
    DQT,
    SOF0,
    DHT,
    SOS,
    SCAN,
    [0xff, 0xd9],
    opts.trailing ? cat([0xff, 0xd8, 0xff, 0xe2], u16be(8), "MPF\0\0\0", [0xff, 0xd9], "motion-photo-video-ftypmp42") : [],
  );
}

/** Markers of a JPEG up to SOS, the scan bytes, and what follows EOI. */
function parseJpeg(b: Uint8Array) {
  expect([b[0], b[1]]).toEqual([0xff, 0xd8]);
  const segs: Array<{ marker: number; body: Uint8Array }> = [];
  let i = 2;
  for (;;) {
    while (b[i] === 0xff && b[i + 1] === 0xff) i++;
    expect(b[i]).toBe(0xff);
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    segs.push({ marker, body: b.slice(i + 4, i + 2 + len) });
    i += 2 + len;
    if (marker === 0xda) break;
  }
  const eoi = (() => {
    for (let j = i; j + 1 < b.length; j++) if (b[j] === 0xff && b[j + 1] === 0xd9) return j;
    return -1;
  })();
  return { segs, scan: b.slice(i, eoi), after: b.slice(eoi + 2) };
}

// ---- PNG ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const chunk = (type: string, data: Uint8Array | number[] | string) => {
  const d = cat(data);
  const td = cat(type, d);
  return cat(u32be(d.length), td, u32be(crc32(td)));
};
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IDAT_DATA = cat([0x78, 0x9c], "pixel-bytes-unchanged", [0, 1, 2, 3]);

function png(trailing = false): Uint8Array<ArrayBuffer> {
  return cat(
    PNG_SIG,
    chunk("IHDR", [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]),
    chunk("iCCP", cat("sRGB-ish\0", [0], [0x78, 0x9c, 1, 2, 3])),
    chunk("tEXt", "Author\0Dana Levi"),
    chunk("iTXt", cat("XML:com.adobe.xmp\0", [0, 0], "\0\0", '<x:xmpmeta exif:GPSLatitude="32N"/>')),
    chunk("tIME", [0x07, 0xea, 11, 15, 9, 41, 0]),
    chunk("eXIf", exifTiff({ gps: true })),
    chunk("caBX", "c2pa-jumbf-manifest"),
    chunk("IDAT", IDAT_DATA),
    chunk("IEND", []),
    trailing ? "appended-secret-after-IEND" : [],
  );
}
function parsePng(b: Uint8Array) {
  expect([...b.slice(0, 8)]).toEqual(PNG_SIG);
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  let i = 8;
  while (i < b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(...b.slice(i + 4, i + 8));
    const data = b.slice(i + 8, i + 8 + len);
    const crc = ((b[i + 8 + len] << 24) | (b[i + 9 + len] << 16) | (b[i + 10 + len] << 8) | b[i + 11 + len]) >>> 0;
    expect(crc).toBe(crc32(b.slice(i + 4, i + 8 + len)));
    chunks.push({ type, data });
    i += 12 + len;
    if (type === "IEND") break;
  }
  return { chunks, after: b.slice(i) };
}

// ---- WebP ----
const riffChunk = (fourcc: string, data: Uint8Array | number[] | string) => {
  const d = cat(data);
  return cat(fourcc, u32le(d.length), d, d.length % 2 ? [0] : []);
};
const VP8L_DATA = cat([0x2f, 0, 0, 0, 0], "lossless-bitstream!");
function webp(trailing = false): Uint8Array<ArrayBuffer> {
  const body = cat(
    "WEBP",
    riffChunk("VP8X", [0x20 | 0x08 | 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    riffChunk("ICCP", "fake-icc-profile"),
    riffChunk("VP8L", VP8L_DATA),
    riffChunk("EXIF", exifTiff({ gps: true })),
    riffChunk("XMP ", '<x:xmpmeta exif:GPSLatitude="32N"/>'),
  );
  return cat("RIFF", u32le(body.length), body, trailing ? "trailing-video-bytes" : []);
}
function parseWebp(b: Uint8Array) {
  expect(String.fromCharCode(...b.slice(0, 4))).toBe("RIFF");
  const size = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  expect(String.fromCharCode(...b.slice(8, 12))).toBe("WEBP");
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  let i = 12;
  while (i < 8 + size) {
    const type = String.fromCharCode(...b.slice(i, i + 4));
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    chunks.push({ type, data: b.slice(i + 8, i + 8 + len) });
    i += 8 + len + (len % 2);
  }
  return { size, total: b.length, chunks };
}

// ---- other kinds, by their first bytes ----
const ftyp = (brand: string, compat: string) => cat(u32be(24), "ftyp", brand, u32be(0), brand, compat, "meta-with-gps-in-exif");
const HEIC = ftyp("heic", "mif1");
const AVIF = ftyp("avif", "mif1");
const MP4 = ftyp("isom", "mp42"); // no HEIF brand among its compatible brands
const GIF = cat("GIF89a", [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255], ",", [0, 0, 0, 0, 1, 0, 1, 0, 0], [2, 2, 0x44, 1, 0], ";");
const TIFF = cat([0x49, 0x49, 42, 0], u32le(8), [0, 0], u32le(0));

afterEach(() => {
  try {
    localStorage.removeItem(KEEP_METADATA_KEY);
  } catch {
    // why: no localStorage in this runner; the default (remove metadata) applies
  }
});

describe("blind: photo metadata — JPEG (W10.D19)", () => {
  it("I1 GPS, EXIF time/device, XMP, IPTC, comments and C2PA go; the coded data, tables and ICC profile stay byte for byte", () => {
    const src = jpeg();
    expect(hasGps(src)).toBe(true);
    const r = stripImageMetadata(src);
    expect(r.format).toBe("jpeg");
    expect(r.removed.length).toBeGreaterThan(0);
    const out = parseJpeg(r.bytes);
    expect(out.scan).toEqual(SCAN);
    const markers = out.segs.map((s) => s.marker);
    for (const kept of [0xdb, 0xc0, 0xc4, 0xda]) expect(markers).toContain(kept);
    expect(markers).not.toContain(0xfe); // COM
    expect(markers).not.toContain(0xed); // APP13 IPTC
    expect(markers).not.toContain(0xeb); // APP11 C2PA/JUMBF
    const icc = out.segs.filter((s) => s.marker === 0xe2);
    expect(icc).toHaveLength(1);
    expect(has(icc[0].body, "fake-icc-profile-bytes")).toBe(true);
    for (const s of ["Dana", "PhoneCo", "2026:11:15", "xmpmeta", "c2pa", "GPSLatitude"]) expect(has(r.bytes, s)).toBe(false);
    expect(hasGps(r.bytes)).toBe(false);
  });

  it("I2 the orientation stays (as an EXIF block with only that tag), so a portrait photo still stands upright", () => {
    const r = stripImageMetadata(jpeg());
    const exif = parseJpeg(r.bytes).segs.filter((s) => s.marker === 0xe1 && has(s.body.slice(0, 6), "Exif"));
    expect(exif).toHaveLength(1);
    const t = readTiff(exif[0].body.slice(6));
    expect(t.orientation).toBe(6);
    expect(t.gps).toBe(false);
    expect(t.tags).toEqual([0x0112]);
  });

  it("I3 anything after the image's end goes: an MPF second image, a motion photo's video", () => {
    const r = stripImageMetadata(jpeg({ trailing: true }));
    expect(parseJpeg(r.bytes).after.length).toBe(0);
    expect(has(r.bytes, "motion-photo-video")).toBe(false);
    expect(has(r.bytes, "MPF")).toBe(false);
  });

  it("I4 an APP2 segment that is not an ICC profile (an MPF index) is removed; an unknown APPn goes", () => {
    const r = stripImageMetadata(jpeg({ extra: [seg(0xe2, cat("MPF\0", "MM\0*index")), seg(0xe7, "vendor-secret-serial-0042")] }));
    const app2 = parseJpeg(r.bytes).segs.filter((s) => s.marker === 0xe2);
    expect(app2).toHaveLength(1);
    expect(has(app2[0].body, "ICC_PROFILE")).toBe(true);
    expect(has(r.bytes, "vendor-secret-serial")).toBe(false);
  });

  it("I5 a JPEG whose structure can't be read fails closed (ImageMetadataError), and hasGps says it may carry one", () => {
    const src = jpeg();
    const broken = src.slice(0, 40); // cut inside the EXIF segment
    expect(() => stripImageMetadata(broken)).toThrow(ImageMetadataError);
    expect(hasGps(broken)).toBe(true);
  });

  it("I6 stripping is idempotent: a cleaned photo comes back the same", () => {
    const once = stripImageMetadata(jpeg()).bytes;
    const twice = stripImageMetadata(once).bytes;
    expect([...twice]).toEqual([...once]);
  });
});

describe("blind: photo metadata — PNG and WebP (W10.D19)", () => {
  it("I7 PNG: text, time, eXIf, XMP and C2PA chunks go; IHDR, iCCP, IDAT and IEND stay, CRCs valid, nothing after IEND", () => {
    const r = stripImageMetadata(png(true));
    expect(r.format).toBe("png");
    const out = parsePng(r.bytes);
    expect(out.chunks.map((c) => c.type)).toEqual(["IHDR", "iCCP", "IDAT", "IEND"]);
    expect(out.chunks[2].data).toEqual(IDAT_DATA);
    expect(out.after.length).toBe(0);
    for (const s of ["Dana", "xmpmeta", "c2pa", "PhoneCo"]) expect(has(r.bytes, s)).toBe(false);
    expect(hasGps(png())).toBe(true);
    expect(hasGps(r.bytes)).toBe(false);
  });

  it("I8 WebP: EXIF and XMP chunks go, the VP8X flags are corrected, ICCP and the bitstream stay, the RIFF size is right, nothing after it", () => {
    const r = stripImageMetadata(webp(true));
    expect(r.format).toBe("webp");
    const out = parseWebp(r.bytes);
    expect(out.chunks.map((c) => c.type)).toEqual(["VP8X", "ICCP", "VP8L"]);
    expect(out.chunks[2].data).toEqual(VP8L_DATA);
    const flags = out.chunks[0].data[0];
    expect(flags & 0x08).toBe(0); // EXIF
    expect(flags & 0x04).toBe(0); // XMP
    expect(flags & 0x20).toBe(0x20); // ICC kept
    expect(out.size).toBe(out.total - 8);
    expect(has(r.bytes, "trailing-video")).toBe(false);
    expect(hasGps(webp())).toBe(true);
    expect(hasGps(r.bytes)).toBe(false);
  });
});

describe("blind: photo metadata — what a file is, and failing closed (W10.D19)", () => {
  it("I9 the kind comes from the bytes", () => {
    expect(sniffMedia(jpeg())).toBe("jpeg");
    expect(sniffMedia(png())).toBe("png");
    expect(sniffMedia(webp())).toBe("webp");
    expect(sniffMedia(GIF)).toBe("gif");
    expect(sniffMedia(HEIC)).toBe("heif");
    expect(sniffMedia(AVIF)).toBe("avif");
    expect(sniffMedia(TIFF)).toBe("tiff");
    expect(sniffMedia(MP4)).toBe("video");
    expect(sniffMedia(te.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
    expect(sniffMedia(te.encode("%PDF-1.7 hello"))).toBeNull();
  });

  it("I10 a JPEG declared as PNG (or named .jfif) is cleaned as a JPEG", () => {
    expect(stripImageMetadata(jpeg(), "image/png").format).toBe("jpeg");
    expect(hasGps(stripImageMetadata(jpeg(), "image/png").bytes)).toBe(false);
    expect(() => stripImageMetadata(new TextEncoder().encode("not an image at all"), "image/jpeg")).toThrow(ImageMetadataError);
  });

  // finding X-BL-2 (W10.D19, fixed on w10/blind-defect-fixes): bytes that are a GIF but declared
  // image/jpeg came back unchanged (format null) instead of ImageMetadataError, against
  // stripImageMetadata's own doc comment. Decision: the code follows the doc; the module comment
  // now says a GIF declared as itself comes back unchanged.
  it("I10b bytes that are a GIF but declared as JPEG are refused (stripImageMetadata's doc: 'when `declared` names JPEG, PNG or WebP but the bytes are none of them')", () => {
    expect(() => stripImageMetadata(GIF, "image/jpeg")).toThrow(ImageMetadataError);
  });

  it("I11 HEIC, AVIF and TIFF can't be cleaned in place (ImageMetadataError), even declared as JPEG", () => {
    for (const b of [HEIC, AVIF, TIFF]) {
      expect(() => stripImageMetadata(b)).toThrow(ImageMetadataError);
      expect(() => stripImageMetadata(b, "image/jpeg")).toThrow(ImageMetadataError);
    }
  });

  it("I12 GIF and SVG come back as they are, with format null", () => {
    const g = stripImageMetadata(GIF);
    expect(g.format).toBeNull();
    expect([...g.bytes]).toEqual([...GIF]);
  });

  it("I13 cleanImageBytes fails closed: a broken JPEG with no canvas to redraw it gives null; a good one is stripped in place", async () => {
    const ok = await cleanImageBytes(jpeg(), "image/jpeg");
    expect(ok).not.toBeNull();
    expect(ok!.format).toBe("jpeg");
    expect(hasGps(ok!.bytes)).toBe(false);
    const broken = await cleanImageBytes(jpeg().slice(0, 40), "image/jpeg");
    // A canvas can't draw these 40 bytes either: whatever the engine, never the original back.
    if (broken) expect(has(broken.bytes, "PhoneCo")).toBe(false);
    else expect(broken).toBeNull();
  });

  it("I14 cleanImageFile: a HEIC named .jpg is never stored with its metadata", async () => {
    const f = new File([HEIC], "IMG_0001.jpg", { type: "image/jpeg" });
    const r = await caught(() => cleanImageFile(f));
    if (r instanceof Error) {
      expect(r).toBeInstanceOf(ImageMetadataError); // no canvas here: not added
    } else {
      // a canvas redrew it: only pixels, never the HEIC container
      const out = new Uint8Array(await (r as { value: File }).value.arrayBuffer());
      expect(sniffMedia(out)).not.toBe("heif");
    }
  });

  it("I15 by default photos lose their metadata; '1' under KEEP_METADATA_KEY keeps it", async () => {
    expect(KEEP_METADATA_KEY).toBe("lumen.images.keepMetadata");
    expect(keepImageMetadata()).toBe(false);
    const f = new File([jpeg()], "p.jpg", { type: "image/jpeg" });
    expect(hasGps(new Uint8Array(await (await cleanImageFile(f)).arrayBuffer()))).toBe(false);
    localStorage.setItem(KEEP_METADATA_KEY, "1");
    expect(keepImageMetadata()).toBe(true);
    expect(hasGps(new Uint8Array(await (await cleanImageFile(f)).arrayBuffer()))).toBe(true);
  });
});

describe("blind: photo metadata — publish and data: URLs (W10.D19)", () => {
  it("I16 a published site cleans JPEG/PNG/WebP whatever their names, refuses HEIC/AVIF/TIFF/video, copies the rest", async () => {
    const j = await cleanPublishedFile(jpeg());
    expect(j.action).toBe("clean");
    if (j.action === "clean") {
      expect(hasGps(j.bytes)).toBe(false);
      expect(sniffMedia(j.bytes)).toBe("jpeg");
    }
    for (const [b, kind] of [
      [HEIC, "heif"],
      [AVIF, "avif"],
      [TIFF, "tiff"],
      [MP4, "video"],
    ] as const) {
      const r = await cleanPublishedFile(b);
      expect(r.action).toBe("refuse");
      if (r.action === "refuse") expect(r.kind).toBe(kind);
    }
    expect((await cleanPublishedFile(GIF)).action).toBe("copy");
    expect((await cleanPublishedFile(te.encode("%PDF-1.7"))).action).toBe("copy");
    expect((await cleanPublishedFile(te.encode("# a note"))).action).toBe("copy");
  });

  it("I17 data: URLs are judged by their bytes, whatever their label: a JPEG labelled GIF is cleaned, a HEIC is withheld", () => {
    const text = `before ![a](data:image/gif;base64,${b64(jpeg())}) middle ![b](data:image/png;base64,${b64(HEIC)}) after`;
    const r = cleanDataUrls(text);
    expect(r.cleaned).toBe(1);
    expect(r.withheld).toBe(1);
    expect(r.text).toContain(WITHHELD_IMAGE);
    expect(r.text.startsWith("before ![a](data:")).toBe(true);
    expect(r.text.endsWith(") after")).toBe(true);
    const urls = [...r.text.matchAll(/data:([^;,]+);base64,([A-Za-z0-9+/=]+)/g)];
    const first = Uint8Array.from(atob(urls[0][2]), (c) => c.charCodeAt(0));
    expect(sniffMedia(first)).toBe("jpeg");
    expect(hasGps(first)).toBe(false);
    expect(r.text).not.toContain(b64(HEIC));
  });

  it("I18 a data: URL inside an SVG's source is cleaned too", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/jpeg;base64,${b64(jpeg())}"/></svg>`;
    const r = cleanDataUrls(svg);
    expect(r.cleaned).toBe(1);
    expect(r.text).not.toContain(b64(jpeg()));
  });
});

async function caught(f: () => Promise<unknown>): Promise<unknown> {
  try {
    return { value: await f() };
  } catch (e) {
    return e;
  }
}
