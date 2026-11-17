/**
 * W2.22 / W10.E17 — the synthetic vault's attachments: `totalBytes` spread
 * over `count` files (PDFs, images, audio by name), made sparse with
 * ftruncate, so a 5 GB vault takes almost no disk and no time to write.
 * Each file starts with its format's real magic bytes, so a reader that
 * sniffs the type sees a PDF, a PNG or an MP3; the rest is a hole.
 *
 *   node scripts/perf/sparseAttachments.mjs <dir> [--gb 5] [--count 500]
 */
import { closeSync, mkdirSync, openSync, statSync, writeSync, ftruncateSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KINDS = [
  { ext: "pdf", magic: Buffer.from("%PDF-1.7\n") },
  { ext: "png", magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { ext: "mp3", magic: Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1") },
];

/** Writes the files; returns their paths, the apparent total and what the disk really allocated. */
export function makeSparseAttachments(dir, totalBytes, count = 500) {
  mkdirSync(join(dir, "attachments"), { recursive: true });
  const each = Math.floor(totalBytes / count);
  const files = [];
  let apparent = 0;
  let allocated = 0;
  for (let i = 0; i < count; i++) {
    const kind = KINDS[i % KINDS.length];
    const size = i === count - 1 ? totalBytes - each * (count - 1) : each;
    const path = join(dir, "attachments", `a${String(i).padStart(4, "0")}.${kind.ext}`);
    const fd = openSync(path, "w");
    try {
      writeSync(fd, kind.magic, 0, Math.min(kind.magic.length, size), 0);
      ftruncateSync(fd, size);
    } finally {
      closeSync(fd);
    }
    const st = statSync(path);
    apparent += st.size;
    allocated += st.blocks * 512;
    files.push(path);
  }
  return { files, apparentBytes: apparent, allocatedBytes: allocated };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: sparseAttachments.mjs <dir> [--gb 5] [--count 500]");
  const opt = (n, d) => (process.argv.includes(n) ? Number(process.argv[process.argv.indexOf(n) + 1]) : d);
  const r = makeSparseAttachments(dir, Math.round(opt("--gb", 5) * 1024 ** 3), opt("--count", 500));
  console.log(JSON.stringify({ files: r.files.length, apparentGB: +(r.apparentBytes / 1024 ** 3).toFixed(2), allocatedMB: +(r.allocatedBytes / 1024 ** 2).toFixed(1) }));
}
