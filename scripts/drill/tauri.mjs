/**
 * The desktop save path of the shipped code (plan W4.33, W10.E40), not a
 * port: the Rust vault's own `Vault::write` (src-tauri/vault/src/lib.rs:
 * temporary sibling, sync_all, rename), in the small binary
 * ./tauri-writer, which this module drives over stdin. The binary is built
 * with `cargo build --release` (once; `LUMEN_DRILL_TAURI_WRITER=<path>`
 * uses one built elsewhere). A drill process that is killed takes the
 * writer with it: both are in one process group.
 */
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const crate = join(here, "tauri-writer");

/** The writer binary, built when it is missing. Throws when there is no Rust toolchain. */
export function tauriWriter() {
  const pre = process.env.LUMEN_DRILL_TAURI_WRITER;
  if (pre) {
    if (!existsSync(pre)) throw new Error(`LUMEN_DRILL_TAURI_WRITER: ${pre} does not exist`);
    return pre;
  }
  const bin = join(crate, "target", "release", "lumen-drill-tauri-writer");
  if (!existsSync(bin)) execFileSync("cargo", ["build", "--release", "--quiet", "--manifest-path", join(crate, "Cargo.toml")], { stdio: "inherit" });
  return bin;
}

/** One writer process over `root`: `save(path, bytes)` resolves when Vault::write returned. */
export function openTauriWriter(bin, root) {
  const child = spawn(bin, [root], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = [];
  let buf = "";
  const ready = new Promise((res, rej) => {
    waiting.push({ res, rej });
    child.once("exit", (code, signal) => {
      for (const w of waiting.splice(0)) w.rej(new Error(`the tauri writer ended (code ${code}, signal ${signal})`));
    });
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const w = waiting.shift();
      if (!w) continue;
      if (line === "ok" || line === "ready") w.res();
      else w.rej(new Error(line.replace(/^err /, "")));
    }
  });
  let chain = ready;
  return {
    ready,
    save(path, bytes) {
      // One request at a time, in order, as the app's command handler takes them.
      const done = chain.then(
        () =>
          new Promise((res, rej) => {
            waiting.push({ res, rej });
            child.stdin.write(`${path}\t${bytes.byteLength}\n`);
            child.stdin.write(bytes);
          }),
      );
      chain = done.catch(() => undefined);
      return done;
    },
    close: () => child.stdin.end(),
  };
}

/**
 * The `tauri` path for data-safety-drill.mjs. The binary is copied into the
 * drill's work folder, which every saving process can read (the permission
 * drill saves as another user), and the saving processes are pointed at it.
 */
export function tauriPath(work) {
  let bin = tauriWriter();
  if (work && !bin.startsWith(work)) {
    const copy = join(work, "lumen-drill-tauri-writer");
    copyFileSync(bin, copy);
    chmodSync(copy, 0o755);
    process.env.LUMEN_DRILL_TAURI_WRITER = bin = copy;
  }
  return {
    name: "tauri",
    source: "src-tauri/vault/src/lib.rs Vault::write (real code, scripts/drill/tauri-writer)",
    open(root) {
      // Started on the first save: the drill's parent opens a path only to recover and audit it.
      let w = null;
      return {
        save: async (p, bytes) => {
          w ??= openTauriWriter(bin, root);
          await w.ready;
          return w.save(p, bytes);
        },
        // The Rust vault leaves `.lumen-tmp-*` behind after a crash and lists
        // past them; the drill counts them separately (not as damage).
        recover: async () => [],
        tempPrefix: ".lumen-tmp-",
      };
    },
  };
}
