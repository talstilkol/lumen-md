#!/usr/bin/env node
/**
 * Plan W10.D11 — the "Integrity" column of docs/security/crypto-libs.md:
 * for each audited crypto library, the version the range resolves to today
 * and the registry's sha512 integrity of that tarball.
 *
 *   node scripts/crypto/lib-integrity.mjs [--json out.json]
 *
 * Needs the npm registry (the Mac; it is blocked in the cloud). Prints one
 * JSON line and a Markdown row per library to paste into the table. Exit 0
 * only when every library resolved to a version with a sha512 integrity.
 * After `npm i -E` (crypto-libs.md, step 1) the lockfile's `integrity` must
 * equal the value printed here: `--lock` checks that.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/** The libraries and ranges of docs/security/crypto-libs.md ("The libraries"). */
export const LIBS = [
  { name: "@noble/ciphers", range: "^2" },
  { name: "@noble/hashes", range: "^2" },
  { name: "hash-wasm", range: "^4" },
  { name: "libsodium-wrappers-sumo", range: "0.8.4" },
  { name: "age-encryption", range: "latest" },
];

/** `npm view` JSON for a range: one object, or an array (one per matching version). */
export function pickLatest(viewJson) {
  const list = Array.isArray(viewJson) ? viewJson : [viewJson];
  const last = list.filter((x) => x && typeof x.version === "string").at(-1);
  if (!last) return null;
  const integrity = last["dist.integrity"] ?? last.dist?.integrity ?? null;
  return { version: last.version, integrity: typeof integrity === "string" && integrity.startsWith("sha512-") ? integrity : null };
}

function view({ name, range }) {
  const r = spawnSync("npm", ["view", `${name}@${range}`, "version", "dist.integrity", "--json"], { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) return { name, range, version: null, integrity: null, error: (r.stderr || r.error?.message || "npm view failed").trim().split("\n").filter((x) => !/complete log/.test(x)).slice(0, 2).join(" ") };
  try {
    return { name, range, ...(pickLatest(JSON.parse(r.stdout)) ?? { version: null, integrity: null }) };
  } catch (e) {
    return { name, range, version: null, integrity: null, error: String(e) };
  }
}

function lockIntegrity(name) {
  if (!existsSync("package-lock.json")) return null;
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  return lock.packages?.[`node_modules/${name}`]?.integrity ?? null;
}

const argv = process.argv.slice(2);
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const libs = LIBS.map(view).map((l) => (argv.includes("--lock") ? { ...l, lock: lockIntegrity(l.name), lockMatches: lockIntegrity(l.name) === l.integrity } : l));
  const ok = libs.every((l) => l.version && l.integrity && (!argv.includes("--lock") || l.lockMatches));
  const result = { id: "W10.D11", ok, libs };
  const out = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;
  if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  for (const l of libs) console.error(`| ${l.name} | ${l.version ?? "?"} | \`${l.integrity ?? "?"}\` |`);
  process.exit(ok ? 0 : 1);
}
