/**
 * Streaming stores for the sync benchmark (scripts/bench/sync-first.ts).
 *
 * The first version kept every byte in memory three times over: device A's
 * attachments, the WebDAV server's sealed copies and device B's downloads.
 * With 1 GB of attachments that is 3 GB of buffers before any transient copy,
 * and the run was killed by the OOM killer on a 7 GB machine (rc 137, L4).
 * The sync engine itself holds one file at a time (it reads, seals and puts
 * each blob in turn, and keeps no base copy past BASE_BYTES_LIMIT), so the
 * benchmark's own stores were what grew. These keep the benchmark's memory
 * flat in the attachment size:
 *
 *  - `virtualAttachments`: device A's attachments are generated on each read
 *    from (seed, index) with an AES-256-CTR keystream, never stored;
 *  - `hashOnlyFiles`: device B keeps the hash and size of a large download,
 *    not its bytes (the check is the hash the engine already verified);
 *  - `spillToDisk`: the WebDAV server's files past a threshold live in a
 *    temporary folder; the Map holds only the name and the ETag.
 */
import { createCipheriv, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalFile, LocalFiles } from "../../src/sync/e2ee/localFiles";
import type { WebdavFile } from "../../src/__tests__/helpers/fakeServers/webdav";

/** `size` deterministic pseudo-random bytes for attachment `index` (AES-256-CTR over zeros). */
export function attachmentBytes(seed: number, index: number, size: number): Uint8Array {
  const key = createHash("sha256").update(`lumen-sync-bench:${seed}:${index}`).digest();
  const c = createCipheriv("aes-256-ctr", key, Buffer.alloc(16));
  const out = c.update(Buffer.alloc(size));
  c.final();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

const sha = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");

/**
 * Device A: `base` (the notes, in memory) plus `count` attachments of `each`
 * bytes under `attachments/`, generated on every read. The hash of each is
 * computed once, by streaming the keystream through SHA-256 in 1 MB pieces.
 */
export function virtualAttachments(base: LocalFiles, opts: { seed: number; count: number; each: number }): LocalFiles & { paths: string[] } {
  const paths = Array.from({ length: opts.count }, (_, i) => `attachments/file-${i}.bin`);
  const index = new Map(paths.map((p, i) => [p, i]));
  const hashes = new Map<string, string>();
  const hashOf = (p: string): string => {
    let h = hashes.get(p);
    if (h === undefined) {
      const i = index.get(p)!;
      const key = createHash("sha256").update(`lumen-sync-bench:${opts.seed}:${i}`).digest();
      const c = createCipheriv("aes-256-ctr", key, Buffer.alloc(16));
      const hash = createHash("sha256");
      const piece = Buffer.alloc(Math.min(opts.each, 1 << 20));
      for (let left = opts.each; left > 0; left -= piece.length) hash.update(c.update(left >= piece.length ? piece : piece.subarray(0, left)));
      c.final();
      h = hash.digest("hex");
      hashes.set(p, h);
    }
    return h;
  };
  return {
    paths,
    async list(): Promise<LocalFile[]> {
      return [...(await base.list()), ...paths.map((path) => ({ path, hash: hashOf(path), size: opts.each }))];
    },
    async read(path) {
      const i = index.get(path);
      return i === undefined ? base.read(path) : attachmentBytes(opts.seed, i, opts.each);
    },
    async write(path, data, expect) {
      if (index.has(path)) throw new Error(`the benchmark's attachments are read-only (${path})`);
      return base.write(path, data, expect);
    },
    async remove(path, expect) {
      if (index.has(path)) throw new Error(`the benchmark's attachments are read-only (${path})`);
      return base.remove(path, expect);
    },
  };
}

/**
 * Device B: files of `keepBytes` or more are kept as hash and size only;
 * smaller ones go to `base`. `held()` is the number of bytes this layer keeps
 * (always 0: it is what the memory test checks).
 */
export function hashOnlyFiles(base: LocalFiles, keepBytes = 1 << 20): LocalFiles & { hashes: Map<string, { hash: string; size: number }>; held: () => number } {
  const hashes = new Map<string, { hash: string; size: number }>();
  return {
    hashes,
    held: () => 0,
    async list() {
      return [...(await base.list()), ...[...hashes].map(([path, h]) => ({ path, hash: h.hash, size: h.size }))];
    },
    async read(path) {
      if (hashes.has(path)) throw new Error(`the benchmark keeps only the hash of ${path}`);
      return base.read(path);
    },
    async write(path, data, expect) {
      if (data.length < keepBytes && !hashes.has(path)) return base.write(path, data, expect);
      const cur = hashes.get(path)?.hash ?? null;
      if (cur !== expect) return false;
      hashes.set(path, { hash: sha(data), size: data.length });
      return true;
    },
    async remove(path, expect) {
      const cur = hashes.get(path);
      if (!cur) return base.remove(path, expect);
      if (cur.hash !== expect) return false;
      hashes.delete(path);
      return true;
    },
  };
}

/**
 * Replace a fake WebDAV server's in-memory `files` map with one that writes
 * every file of `spillBytes` or more to a temporary folder. `bytesInMemory()`
 * is what the map still holds; `dispose()` removes the folder.
 */
export function spillToDisk(files: Map<string, WebdavFile>, spillBytes = 1 << 20): { bytesInMemory: () => number; bytesOnDisk: () => number; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "lumen-sync-bench-"));
  let seq = 0;
  let onDisk = 0;
  const sizes = new Map<string, number>();
  const set = files.set.bind(files);
  const del = files.delete.bind(files);
  const drop = (k: string) => {
    const old = files.get(k) as (WebdavFile & { file?: string }) | undefined;
    if (old?.file) {
      try {
        unlinkSync(old.file);
      } catch {
        // why: a missing spill file only costs disk space in a temporary folder
      }
      onDisk -= sizes.get(k) ?? 0;
      sizes.delete(k);
    }
  };
  files.set = (k: string, v: WebdavFile) => {
    drop(k);
    if (v.data.length < spillBytes) return set(k, v);
    const file = join(dir, `f${++seq}`);
    writeFileSync(file, v.data);
    onDisk += v.data.length;
    sizes.set(k, v.data.length);
    const etag = v.etag;
    return set(k, {
      etag,
      file,
      get data() {
        const b = readFileSync(file);
        return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      },
    } as WebdavFile);
  };
  files.delete = (k: string) => {
    drop(k);
    return del(k);
  };
  return {
    bytesOnDisk: () => onDisk,
    bytesInMemory: () => {
      let n = 0;
      for (const v of files.values()) if (!(v as { file?: string }).file) n += v.data.length;
      return n;
    },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The process's peak resident size in MB, sampled every `everyMs` until `stop()`. */
export function rssSampler(everyMs = 50): { peakMB: () => number; stop: () => number } {
  let peak = process.memoryUsage().rss;
  const t = setInterval(() => {
    const r = process.memoryUsage().rss;
    if (r > peak) peak = r;
  }, everyMs);
  t.unref();
  const peakMB = () => Math.round(Math.max(peak, process.memoryUsage().rss) / 1024 / 1024);
  return { peakMB, stop: () => (clearInterval(t), peakMB()) };
}
