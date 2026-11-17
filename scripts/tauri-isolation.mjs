#!/usr/bin/env node
/**
 * Tauri's isolation pattern for Lumen (plan W11.S18):
 *
 *   node scripts/tauri-isolation.mjs --snapshot        rewrite security/tauri-capabilities.snapshot.json
 *   node scripts/tauri-isolation.mjs --check           exit 1 when a capability file differs from its
 *                                                      snapshot, grants a forbidden permission, or
 *                                                      the isolation app's command list differs from lib.rs
 *   node scripts/tauri-isolation.mjs --enable          (owner, with network) turn the pattern on:
 *                                                      app.security.pattern in tauri.conf.json and the
 *                                                      tauri crate's "isolation" feature in Cargo.toml;
 *                                                      then `cargo update -p tauri` adds its crates to
 *                                                      Cargo.lock (aes-gcm is not there yet)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SNAPSHOT = "security/tauri-capabilities.snapshot.json";
export const CAPS = "src-tauri/capabilities";
/** Permission prefixes the webview's capability may never grant. */
export const FORBIDDEN = ["updater:", "shell:", "fs:", "process:", "http:", "opener:"];

/** A capability file as the snapshot keeps it: identifier, windows and permissions, sorted. */
export function normalise(cap) {
  const perms = (cap.permissions ?? []).map((p) => (typeof p === "string" ? p : `${p.identifier}${p.allow ? ` allow=${JSON.stringify(p.allow)}` : ""}${p.deny ? ` deny=${JSON.stringify(p.deny)}` : ""}`));
  return { identifier: cap.identifier, windows: [...(cap.windows ?? [])].sort(), permissions: [...perms].sort(), ...(cap.platforms ? { platforms: [...cap.platforms].sort() } : {}), ...(cap.remote ? { remote: cap.remote } : {}) };
}

export function readCapabilities(root) {
  const dir = join(root, CAPS);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .map((n) => [n, normalise(JSON.parse(readFileSync(join(dir, n), "utf8")))]),
  );
}

/** The app's IPC commands, from src-tauri/src/lib.rs's generate_handler! list. */
export function rustCommands(root) {
  const src = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  const at = src.indexOf("generate_handler![");
  const block = src.slice(at + "generate_handler![".length, src.indexOf("])", at));
  return block
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ""))
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("#["))
    .map((l) => l.split("::").pop());
}

/** The isolation app's COMMANDS list (read as text: the file is a classic script for the iframe). */
export function isolationCommands(root) {
  const js = readFileSync(join(root, "src-tauri/isolation/index.js"), "utf8");
  const m = /var COMMANDS = \[([\s\S]*?)\];/.exec(js);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
}

export function problems(root) {
  const out = [];
  const caps = readCapabilities(root);
  let snap = {};
  try {
    snap = JSON.parse(readFileSync(join(root, SNAPSHOT), "utf8"));
  } catch {
    out.push(`${SNAPSHOT} is missing: run node scripts/tauri-isolation.mjs --snapshot`);
  }
  for (const [name, cap] of Object.entries(caps)) {
    for (const p of cap.permissions) if (FORBIDDEN.some((f) => p.startsWith(f))) out.push(`${CAPS}/${name} grants ${p}: the webview may never have it`);
    if (snap[name] && JSON.stringify(snap[name]) !== JSON.stringify(cap)) out.push(`${CAPS}/${name} changed: review it, then run node scripts/tauri-isolation.mjs --snapshot`);
    if (!snap[name] && Object.keys(snap).length) out.push(`${CAPS}/${name} is new: review it, then run --snapshot`);
  }
  for (const name of Object.keys(snap)) if (!caps[name]) out.push(`${CAPS}/${name} is gone: run --snapshot`);
  const rs = rustCommands(root);
  const iso = isolationCommands(root);
  const missing = rs.filter((c) => !iso.includes(c));
  const extra = iso.filter((c) => !rs.includes(c));
  if (missing.length) out.push(`src-tauri/isolation/index.js doesn't allow ${missing.join(", ")} (in lib.rs): add it after review`);
  if (extra.length) out.push(`src-tauri/isolation/index.js allows ${extra.join(", ")}, which lib.rs doesn't have`);
  return out;
}

/** tauri.conf.json and Cargo.toml with the isolation pattern on. */
export function enable(conf, cargoToml) {
  const c = structuredClone(conf);
  c.app ??= {};
  c.app.security ??= {};
  c.app.security.pattern = { use: "isolation", options: { dir: "isolation" } };
  const cargo = cargoToml.replace(/^tauri = \{ version = "2", features = \[([^\]]*)\] \}$/m, (line, feats) => (/"isolation"/.test(feats) ? line : `tauri = { version = "2", features = [${feats}${feats.trim() ? ", " : ""}"isolation"] }`));
  return { conf: c, cargo };
}

function main(argv) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (argv.includes("--snapshot")) {
    writeFileSync(join(root, SNAPSHOT), JSON.stringify(readCapabilities(root), null, 2) + "\n");
    console.log(`wrote ${SNAPSHOT}`);
    return 0;
  }
  if (argv.includes("--enable")) {
    const confPath = join(root, "src-tauri/tauri.conf.json");
    const cargoPath = join(root, "src-tauri/Cargo.toml");
    const { conf, cargo } = enable(JSON.parse(readFileSync(confPath, "utf8")), readFileSync(cargoPath, "utf8"));
    writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
    writeFileSync(cargoPath, cargo);
    console.log("isolation pattern on: now run `cd src-tauri && cargo update -p tauri && cargo build` (network), then the desktop e2e");
    return 0;
  }
  const p = problems(root);
  for (const x of p) console.error(`✖ ${x}`);
  if (p.length) return 1;
  console.log(`✓ tauri: ${Object.keys(readCapabilities(root)).length} capability file(s) match their snapshot, none grants a forbidden permission, and the isolation app allows exactly lib.rs's ${rustCommands(root).length} commands`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
