/**
 * Google Play's 16 KB page-size requirement (plan W11.P11): every native
 * library an app ships must work on a device whose memory pages are 16 KB.
 *
 * Two things are checked, the same two that `zipalign -c -P 16` and
 * Android Studio's APK Analyzer check:
 *
 * 1. **ELF:** every `PT_LOAD` segment of every `.so` is aligned to at least
 *    16 KB (`p_align >= 0x4000`, a power of two). A library linked for 4 KB
 *    pages can't load on a 16 KB device.
 * 2. **The zip (an .apk only):** a `.so` stored uncompressed starts on a 16 KB
 *    boundary in the file, so the system can map it straight from the APK.
 *    A compressed `.so` is extracted at install, so its offset doesn't matter.
 *    In an .aab, bundletool lays out the APKs, so only the ELF is checked.
 *
 * Pure Node (node:zlib for compressed entries), no dependencies.
 */
import { inflateRawSync } from "node:zlib";

export const PAGE_16K = 0x4000;

/** The zip's entries: name, method, sizes, and where the data starts. */
export function zipEntries(buf) {
  // End of central directory: the last 0x06054b50 within the final 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0x10000 - 22); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end of central directory)");
  let count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  if (cd === 0xffffffff || count === 0xffff) {
    // Zip64: the locator sits just before the EOCD.
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw new Error("zip64 without a locator");
    const rec = Number(buf.readBigUInt64LE(loc + 8));
    count = Number(buf.readBigUInt64LE(rec + 32));
    cd = Number(buf.readBigUInt64LE(rec + 48));
  }
  const out = [];
  let p = cd;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory entry at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    let compressed = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // Zip64 extra field (id 1): the 0xffffffff fields, in order.
    for (let e = p + 46 + nameLen; e < p + 46 + nameLen + extraLen; ) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 1) {
        let q = e + 4;
        if (size === 0xffffffff) (size = Number(buf.readBigUInt64LE(q))), (q += 8);
        if (compressed === 0xffffffff) (compressed = Number(buf.readBigUInt64LE(q))), (q += 8);
        if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(q));
      }
      e += 4 + len;
    }
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const dataOffset = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({ name, method, compressed, size, dataOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function entryData(buf, e) {
  const raw = buf.subarray(e.dataOffset, e.dataOffset + e.compressed);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRawSync(raw);
  throw new Error(`${e.name}: compression method ${e.method} is not supported`);
}

/** The PT_LOAD segments' alignments of an ELF file; throws when it is not ELF. */
export function elfLoadAlignments(elf) {
  if (elf.length < 52 || elf.readUInt32BE(0) !== 0x7f454c46) throw new Error("not an ELF file");
  const is64 = elf[4] === 2;
  const le = elf[5] === 1;
  const u16 = (o) => (le ? elf.readUInt16LE(o) : elf.readUInt16BE(o));
  const u32 = (o) => (le ? elf.readUInt32LE(o) : elf.readUInt32BE(o));
  const u64 = (o) => Number(le ? elf.readBigUInt64LE(o) : elf.readBigUInt64BE(o));
  const phoff = is64 ? u64(0x20) : u32(0x1c);
  const phentsize = u16(is64 ? 0x36 : 0x2a);
  const phnum = u16(is64 ? 0x38 : 0x2c);
  const out = [];
  for (let i = 0; i < phnum; i++) {
    const h = phoff + i * phentsize;
    if (h + phentsize > elf.length) throw new Error("program header table runs past the end");
    if (u32(h) !== 1) continue; // PT_LOAD
    out.push(is64 ? u64(h + 0x30) : u32(h + 0x1c));
  }
  return out;
}

const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/**
 * Check one archive (.apk or .aab) or a list of loose `.so` files.
 * Returns one row per library and the problems found.
 */
export function check16k(input) {
  const rows = [];
  const problems = [];
  const one = (name, elf, zipOffset, stored) => {
    let aligns;
    try {
      aligns = elfLoadAlignments(elf);
    } catch (e) {
      problems.push(`${name}: ${e.message}`);
      return;
    }
    const min = aligns.length ? Math.min(...aligns) : 0;
    const elfOk = aligns.length > 0 && aligns.every((a) => a >= PAGE_16K && pow2(a));
    const zipOk = zipOffset === null || !stored || zipOffset % PAGE_16K === 0;
    rows.push({ name, loadSegments: aligns.length, minAlign: min, zipOffset, stored, ok: elfOk && zipOk });
    if (!aligns.length) problems.push(`${name}: no PT_LOAD segment`);
    else if (!elfOk) problems.push(`${name}: a LOAD segment is aligned to ${min} bytes (needs ${PAGE_16K}): relink with -Wl,-z,max-page-size=16384 (NDK r28+ does this by default)`);
    if (!zipOk) problems.push(`${name}: stored uncompressed at offset ${zipOffset}, not a multiple of 16 KB: zipalign -P 16 (AGP 8.5.1+ does this by default)`);
  };
  if (input.kind === "files") {
    for (const f of input.files) one(f.name, f.data, null, false);
    return { rows, problems };
  }
  const isApk = input.kind === "apk";
  for (const e of zipEntries(input.data)) {
    if (!/(^|\/)lib\/[^/]+\/[^/]+\.so$/.test(e.name)) continue;
    one(e.name, entryData(input.data, e), isApk ? e.dataOffset : null, e.method === 0);
  }
  return { rows, problems };
}
