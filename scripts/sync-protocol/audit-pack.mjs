#!/usr/bin/env node
/**
 * The external-audit readiness pack for the encrypted sync (plan W13.S4).
 *
 * Obsidian Sync was audited by Cure53 (10/2024) and Trail of Bits (12/2025)
 * and published both reports; an auditor's first days go to finding the
 * spec, the threat model, a way to build and test, and what is already
 * known. This puts all of it in one deterministic archive:
 *
 *   README.md                 what is inside, the hashes, how to start
 *   spec/sync-protocol.md     the specification (docs/sync-protocol.md)
 *   spec/threat-model.md      assets, actors, trust boundaries, STRIDE (docs/sync-audit/threat-model.md)
 *   spec/scope-questionnaire.md   scope, by the areas Cure53 and Trail of Bits covered (API, server, crypto)
 *   spec/open-findings.md     what is known and open or accepted, with the review that found it
 *   BUILD-AND-TEST.md         one command to build and test, and what each check proves
 *   vectors/sync-protocol-vectors.json
 *   impl/ref-impl.mjs, impl/argon2ref.mjs   the second implementation (node:crypto, RFC 9106), spec only
 *   impl/check_vectors.py, impl/agepy.py    the first independent one (Python)
 *   scope/files.tsv           every in-scope source file of the repository with its SHA-256 (not copied)
 *
 *   node scripts/sync-protocol/audit-pack.mjs [--out <dir>]   build dist/sync-audit-pack/
 *   node scripts/sync-protocol/audit-pack.mjs --check         build it twice (the hash must not change), run
 *                                                             every vector through the second implementation
 *                                                             (100%), and a tampered vector must fail
 *
 * The archive is a plain ustar file with fixed metadata (mtime 0, uid 0,
 * mode 0644, sorted names), so the same tree gives the same SHA-256 on any
 * machine.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Pack path → repository path. */
export const CONTENTS = {
  "spec/sync-protocol.md": "docs/sync-protocol.md",
  "spec/threat-model.md": "docs/sync-audit/threat-model.md",
  "spec/scope-questionnaire.md": "docs/sync-audit/scope-questionnaire.md",
  "spec/open-findings.md": "docs/sync-audit/open-findings.md",
  "BUILD-AND-TEST.md": "docs/sync-audit/BUILD-AND-TEST.md",
  "vectors/sync-protocol-vectors.json": "docs/sync-protocol-vectors.json",
  "impl/ref-impl.mjs": "scripts/sync-protocol/ref-impl.mjs",
  "impl/argon2ref.mjs": "scripts/sync-protocol/argon2ref.mjs",
  "impl/check_vectors.py": "scripts/sync-protocol/check_vectors.py",
  "impl/agepy.py": "scripts/sync-protocol/agepy.py",
};

/** The source an audit covers (listed with hashes in scope/files.tsv): client crypto and sync, the relays. */
export const SCOPE_DIRS = ["src/sync/e2ee", "sync-server", "edge-workers/vault-relay"];
const SCOPE_SKIP = /(^|\/)(node_modules|__tests__|wasm\/.*\.wasm)(\/|$)|package-lock\.json$|Dockerfile$|fly\.toml$/;

/** Each document must carry these headings, so an empty or truncated file can't ship. */
export const REQUIRED_SECTIONS = {
  "docs/sync-audit/threat-model.md": ["## Assets", "## Actors", "## Trust boundaries", "## STRIDE", "## Out of scope"],
  "docs/sync-audit/scope-questionnaire.md": ["## 1. Client API", "## 2. Server", "## 3. Cryptography", "## 4. Logistics"],
  "docs/sync-audit/open-findings.md": ["## Open", "## Accepted (inherent)"],
  "docs/sync-audit/BUILD-AND-TEST.md": ["## One command", "## What each check proves"],
};

function walk(dir) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (SCOPE_SKIP.test(p)) continue;
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs|js|json|rs|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

export function scopeFiles() {
  return SCOPE_DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap(walk).sort();
}

/** Every file of the pack: path → bytes. */
export function packEntries() {
  const entries = new Map();
  for (const [to, from] of Object.entries(CONTENTS)) {
    const p = join(ROOT, from);
    if (!existsSync(p)) throw new Error(`audit pack: ${from} is missing`);
    const text = readFileSync(p);
    for (const h of REQUIRED_SECTIONS[from] ?? []) if (!text.includes(h)) throw new Error(`audit pack: ${from} lacks the section "${h}"`);
    entries.set(to, text);
  }
  const scope = scopeFiles();
  if (scope.length < 20) throw new Error(`audit pack: only ${scope.length} in-scope files found; the scope list would be empty or wrong`);
  entries.set("scope/files.tsv", Buffer.from("sha256\tbytes\tpath\n" + scope.map((f) => { const b = readFileSync(join(ROOT, f)); return `${sha(b)}\t${b.length}\t${f}`; }).join("\n") + "\n"));
  const list = [...entries].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, b]) => `${sha(b)}  ${p}`);
  const readme = [
    "# Lumen encrypted sync: audit readiness pack",
    "",
    "Start with spec/sync-protocol.md and spec/threat-model.md; then BUILD-AND-TEST.md runs every check with one command.",
    "spec/scope-questionnaire.md is the scope, laid out the way Cure53 and Trail of Bits scoped Obsidian Sync (client API, server, cryptography).",
    "spec/open-findings.md lists what is known. scope/files.tsv names every in-scope source file of the repository with its SHA-256.",
    "",
    "Two implementations of the format other than the app's own read every vector: impl/check_vectors.py (Python, pyca/cryptography)",
    "and impl/ref-impl.mjs (JavaScript, node:crypto and RFC 9106 Argon2id). Neither imports the app's code.",
    "",
    "## Contents (SHA-256)",
    "",
    "```",
    ...list,
    "```",
    "",
  ].join("\n");
  entries.set("README.md", Buffer.from(readme));
  return entries;
}

// ── A deterministic ustar archive ─────────────────────────────────────────

function header(name, size) {
  const h = Buffer.alloc(512, 0);
  const put = (s, off, len) => Buffer.from(s, "utf8").copy(h, off, 0, len);
  if (Buffer.byteLength(name) > 100) throw new Error(`audit pack: name too long for ustar: ${name}`);
  put(name, 0, 100);
  put("0000644\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(size.toString(8).padStart(11, "0") + "\0", 124, 12);
  put("00000000000\0", 136, 12);
  h.fill(0x20, 148, 156);
  put("0", 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

export function tar(entries) {
  const parts = [];
  for (const [name, data] of [...entries].sort(([a], [b]) => (a < b ? -1 : 1))) {
    parts.push(header(`lumen-sync-audit-pack/${name}`, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function build(outDir) {
  const entries = packEntries();
  const archive = tar(entries);
  mkdirSync(outDir, { recursive: true });
  for (const [p, b] of entries) {
    mkdirSync(dirname(join(outDir, p)), { recursive: true });
    writeFileSync(join(outDir, p), b);
  }
  writeFileSync(join(outDir, "lumen-sync-audit-pack.tar"), archive);
  const hash = sha(archive);
  writeFileSync(join(outDir, "lumen-sync-audit-pack.tar.sha256"), `${hash}  lumen-sync-audit-pack.tar\n`);
  return { hash, files: entries.size, bytes: archive.length };
}

/** Flip one byte inside the first vault's first blob: the second implementation must refuse it. */
export function tamper(vectors) {
  const v = JSON.parse(JSON.stringify(vectors));
  const objs = v.vaults[0].objects;
  const name = Object.keys(objs).find((n) => n !== "lumen-e2ee-vault" && n !== "lumen-e2ee-keyring");
  const b = Buffer.from(objs[name], "base64");
  b[b.length - 20] ^= 1;
  objs[name] = b.toString("base64");
  return v;
}

async function check() {
  const a = mkdtempSync(join(tmpdir(), "lumen-audit-a-"));
  const b = mkdtempSync(join(tmpdir(), "lumen-audit-b-"));
  try {
    const one = build(a);
    const two = build(b);
    const stable = one.hash === two.hash;
    console.log(`${stable ? "ok  " : "FAIL"}  pack built twice, same SHA-256 ${one.hash} (${one.files} files, ${one.bytes} bytes)`);
    const { checkVectors } = await import("./ref-impl.mjs");
    const vectors = JSON.parse(readFileSync(join(a, "vectors/sync-protocol-vectors.json"), "utf8"));
    const results = checkVectors(vectors);
    const ok = results.filter((r) => r.ok).length;
    const all = results.length > 0 && ok === results.length;
    console.log(`${all ? "ok  " : "FAIL"}  second implementation: ${ok}/${results.length} vectors decode identically`);
    for (const r of results.filter((x) => !x.ok)) console.log(`        FAIL ${r.label}`);
    let tamperCaught = false;
    try {
      tamperCaught = checkVectors(tamper(vectors)).some((r) => !r.ok);
    } catch {
      tamperCaught = true;
    }
    console.log(`${tamperCaught ? "ok  " : "FAIL"}  a vector with one flipped byte is refused (the check can fail)`);
    const scope = readFileSync(join(a, "scope/files.tsv"), "utf8").trim().split("\n").length - 1;
    console.log(`ok    scope: ${scope} source files listed with their SHA-256`);
    return stable && all && tamperCaught;
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) process.exit((await check()) ? 0 : 1);
  const i = args.indexOf("--out");
  const out = resolve(i >= 0 ? args[i + 1] : join(ROOT, "dist/sync-audit-pack"));
  const r = build(out);
  console.log(`audit pack: ${relative(process.cwd(), out) || "."}/lumen-sync-audit-pack.tar  sha256 ${r.hash}  (${r.files} files)`);
}
