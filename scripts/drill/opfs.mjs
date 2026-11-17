/**
 * The OPFS save path of the shipped code (plan W4.33, W10.E40), not a port:
 * the app's own OPFS vault backend (src/storage/vault/opfs.ts →
 * handleBackend.ts) on an engine without `createWritable` (Safari before
 * 26), so every save goes through opfsSyncWrite.ts — its main-thread side
 * and its worker source, run as written. What stands in for the browser is
 * at the API level only:
 *
 *   - `navigator.storage.getDirectory()`: directory and file handles over a
 *     real folder (getDirectoryHandle, getFileHandle, removeEntry, entries,
 *     getFile, move, createSyncAccessHandle → truncate / write / flush /
 *     getSize / close as real system calls, so SIGKILL tears what it tears);
 *   - `Worker` and `URL.createObjectURL`: the worker source the module builds
 *     (or, since W11.Q10, the vault-io module worker the drill bundles next to
 *     it) runs in this process with its own `self`, messages queued as a
 *     worker's are.
 */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const notFound = (what) => Object.assign(new Error(`${what} not found`), { name: "NotFoundError" });
const mismatch = (what) => Object.assign(new Error(`${what} is the other kind`), { name: "TypeMismatchError" });

class FileHandle {
  kind = "file";
  constructor(dir, name) {
    this.dir = dir;
    this.name = name;
  }
  get path() {
    return join(this.dir, this.name);
  }
  async getFile() {
    const bytes = fs.readFileSync(this.path);
    const st = fs.statSync(this.path);
    return Object.assign(new Blob([bytes]), { name: this.name, lastModified: Math.floor(st.mtimeMs) });
  }
  async createSyncAccessHandle() {
    const fd = fs.openSync(this.path, "r+");
    return {
      truncate: (n) => fs.ftruncateSync(fd, n),
      write(buf, opts = {}) {
        const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        const at = opts.at ?? 0;
        // In pieces, as a disk takes them: a kill between two leaves a torn file.
        for (let off = 0; off < view.byteLength; ) off += fs.writeSync(fd, view, off, Math.min(8192, view.byteLength - off), at + off);
        return view.byteLength;
      },
      flush: () => fs.fsyncSync(fd),
      getSize: () => fs.fstatSync(fd).size,
      close: () => fs.closeSync(fd),
    };
  }
  async move(newName) {
    fs.renameSync(this.path, join(this.dir, newName));
    this.name = newName;
  }
}

class DirHandle {
  kind = "directory";
  constructor(path, name = "") {
    this.path = path;
    this.name = name;
  }
  async getDirectoryHandle(name, opts = {}) {
    const p = join(this.path, name);
    if (!fs.existsSync(p)) {
      if (!opts.create) throw notFound(name);
      fs.mkdirSync(p);
    } else if (!fs.statSync(p).isDirectory()) throw mismatch(name);
    return new DirHandle(p, name);
  }
  async getFileHandle(name, opts = {}) {
    const p = join(this.path, name);
    if (!fs.existsSync(p)) {
      if (!opts.create) throw notFound(name);
      fs.closeSync(fs.openSync(p, "a"));
    } else if (fs.statSync(p).isDirectory()) throw mismatch(name);
    return new FileHandle(this.path, name);
  }
  async removeEntry(name, opts = {}) {
    const p = join(this.path, name);
    if (!fs.existsSync(p)) throw notFound(name);
    fs.rmSync(p, { recursive: !!opts.recursive });
  }
  async *entries() {
    for (const e of fs.readdirSync(this.path, { withFileTypes: true })) yield [e.name, e.isDirectory() ? new DirHandle(join(this.path, e.name), e.name) : new FileHandle(this.path, e.name)];
  }
  async *values() {
    for await (const [, h] of this.entries()) yield h;
  }
}

/**
 * A module worker's source as one classic script: bundled (its imports inlined)
 * by esbuild, from the TypeScript file itself (a unit test) or from the
 * script the drill already built in its place.
 */
function workerScript(url) {
  const { buildSync } = require("esbuild");
  const out = buildSync({ entryPoints: [fileURLToPath(url)], bundle: true, format: "iife", write: false, logLevel: "error", loader: { ".ts": "ts" } });
  return out.outputFiles[0].text;
}

/** Install the browser APIs the module reaches for, with `root` as the origin's private folder (the latest call wins: the module's one worker follows it). */
export function installOpfs(root) {
  const blobs = new Map();
  URL.createObjectURL = (blob) => {
    const url = `blob:drill/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  const storage = { getDirectory: async () => new DirHandle(root) };
  Object.defineProperty(globalThis, "navigator", { value: { ...(globalThis.navigator ?? {}), storage }, configurable: true });
  globalThis.Worker = class {
    onmessage = null;
    onerror = null;
    constructor(url) {
      const scope = { onmessage: null, postMessage: (data) => setImmediate(() => this.onmessage?.({ data })) };
      this.scope = scope;
      // The module's worker source, run as a classic worker script runs: `self` and `navigator` are its globals.
      // A blob URL (the worker source the module built) or a module worker's file URL (W11.Q10's vault-io worker, built next to the bundle).
      const source = typeof url === "string" && url.startsWith("blob:") ? blobs.get(url).text() : Promise.resolve(workerScript(new URL(String(url))));
      this.started = source.then((src) => new Function("self", "navigator", src)(scope, { get storage() { return globalThis.navigator.storage; } }));
    }
    postMessage(msg) {
      void this.started.then(() => setImmediate(() => this.scope.onmessage({ data: msg })));
    }
    terminate() {}
  };
}

/** The `opfs-sync` path for data-safety-drill.mjs: `opfs` is the bundled src/storage/vault/opfs.ts. */
export function opfsSyncPath(opfs, atomic) {
  return {
    name: "opfs-sync",
    source: "src/storage/vault/opfs.ts → handleBackend.ts → opfsSyncWrite.ts (main side and worker source, real code; OPFS and Worker at the API level)",
    open(root) {
      installOpfs(root);
      const backend = opfs.createOpfsBackend();
      return {
        save: (p, bytes) => backend.write(p, bytes),
        // The app recovers a folder's save leftovers when it lists it: a fresh backend's listing of every folder.
        async recover() {
          const fresh = opfs.createOpfsBackend();
          for (const d of ["", "notes", "notes/deep"]) await fresh.list(d).catch(() => undefined);
          return [];
        },
        isTemp: (name) => atomic.isTempName(name),
      };
    },
  };
}
