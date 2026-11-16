#!/usr/bin/env node
/**
 * Build the static plugin registry (plan W4.32): no server, just files the
 * app serves from public/plugins/examples/.
 *
 *   node scripts/build-plugin-registry.mjs           # writes index.json, then scan.json
 *   node scripts/build-plugin-registry.mjs --check   # exit 1 when either is out of date, a version fails its scan,
 *                                                    # or index.json.sig no longer matches index.json
 *   node scripts/build-plugin-registry.mjs --keygen <dir>   # owner, once: a new Ed25519 key pair in <dir>
 *   LUMEN_PLUGIN_SIGNING_KEY=<pkcs8.pem> node scripts/build-plugin-registry.mjs --sign
 *                                                    # owner: writes index.json, then signs it (index.json.sig)
 *
 * Every folder with a lumen-plugin.json is one version of one plugin (a
 * new version goes in a folder of its own, e.g. `kanban@1.1.0`, so the
 * bytes a user installed stay listed). Its manifest is validated
 * (src/plugins/runtime/manifest.ts); an id + version appears once; the
 * folder may hold only the manifest, the entries it names, a LICENSE and
 * a README. index.json lists the plugins — the existing order
 * is kept, new ones are added in alphabetical order — with each version's
 * path and the SHA-256 of its code and of its manifest (W10.B3: the
 * manifest names the permissions, so it is covered too). Then scripts/scan-plugins.mjs scans
 * every version (scan.json): a version that fails is not shown in the
 * gallery and cannot be installed.
 *
 * Signing (W10.B3): the owner signs the exact bytes of index.json with an
 * Ed25519 key kept on the owner's machine (scripts/lib/plugin-registry-sign.mjs).
 * The app installs from a registry only when that signature verifies against
 * a pinned key (VITE_PLUGIN_TRUSTED_KEYS) and every downloaded file matches
 * its SHA-256 (src/plugins/install.ts). Any change to index.json — one byte —
 * makes the old signature fail, so `--check` fails until the owner re-signs.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "..");
if (!process.execArgv.includes("--import")) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(join(ROOT, "scripts/lib/ts-register.mjs")).href, SELF, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const { fingerprintOfSpki, generateSigningKey, signRegistryBytes, trustedKeysEnv, verifyRegistryBytes } = await import(pathToFileURL(join(ROOT, "scripts/lib/plugin-registry-sign.mjs")).href);
const { parseManifest } = await import(pathToFileURL(join(ROOT, "src/plugins/runtime/manifest.ts")).href);
const DIR = join(ROOT, "public/plugins/examples");
const INDEX = join(DIR, "index.json");
const check = process.argv.includes("--check");
const signIt = process.argv.includes("--sign");
const SIG = `${INDEX}.sig`;

if (process.argv.includes("--keygen")) {
  const dir = process.argv[process.argv.indexOf("--keygen") + 1];
  if (!dir || dir.startsWith("--")) {
    console.log("usage: node scripts/build-plugin-registry.mjs --keygen <dir outside the repo>");
    process.exit(2);
  }
  const k = generateSigningKey();
  const pem = join(resolve(dir), "lumen-plugin-registry.pem");
  if (existsSync(pem)) {
    console.log(`FAIL ${pem} exists; not overwriting a signing key`);
    process.exit(1);
  }
  writeFileSync(pem, k.privateKeyPem, { mode: 0o600 });
  console.log(`private key: ${pem} (keep it off the repo)`);
  console.log(`fingerprint: ${k.fingerprint}`);
  console.log(`VITE_PLUGIN_TRUSTED_KEYS=${trustedKeysEnv(k.spkiBase64)}`);
  process.exit(0);
}
const ALLOWED_EXTRA = new Set(["LICENSE", "LICENSE.md", "README.md"]);

const problems = [];
const found = new Map();
for (const name of readdirSync(DIR).sort()) {
  const at = join(DIR, name);
  if (!statSync(at).isDirectory() || !existsSync(join(at, "lumen-plugin.json"))) continue;
  let manifest;
  try {
    manifest = parseManifest(readFileSync(join(at, "lumen-plugin.json"), "utf8"));
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
    continue;
  }
  const entries = [manifest.main, ...(manifest.ui ? [manifest.ui] : [])];
  for (const f of entries) if (!existsSync(join(at, f))) problems.push(`${name}: ${f} is missing`);
  for (const f of readdirSync(at)) if (f !== "lumen-plugin.json" && !entries.includes(f) && !ALLOWED_EXTRA.has(f)) problems.push(`${name}: unexpected file ${f} (a plugin is its manifest, its entries, a LICENSE and a README)`);
  const versions = found.get(manifest.id) ?? [];
  const twin = versions.find((v) => v.version === manifest.version);
  if (twin) problems.push(`${name}: ${manifest.id}@${manifest.version} is also in ${twin.path}`);
  const sha256 = existsSync(join(at, manifest.main)) ? createHash("sha256").update(readFileSync(join(at, manifest.main), "utf8")).digest("hex") : "";
  const manifestSha256 = createHash("sha256").update(readFileSync(join(at, "lumen-plugin.json"))).digest("hex");
  found.set(manifest.id, [...versions, { name: manifest.name, version: manifest.version, path: name, sha256, manifestSha256 }]);
}

/** Semantic-version order (pre-releases before their release). */
function semverCmp(a, b) {
  const [ma, pa = ""] = a.split("+")[0].split("-");
  const [mb, pb = ""] = b.split("+")[0].split("-");
  const x = ma.split(".").map(Number);
  const y = mb.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  if (pa === pb) return 0;
  return pa === "" ? 1 : pb === "" ? -1 : pa < pb ? -1 : 1;
}
if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p}`);
  process.exit(1);
}

const previous = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : { plugins: [] };
const order = previous.plugins.map((p) => p.id).filter((id) => found.has(id));
for (const id of [...found.keys()].sort()) if (!order.includes(id)) order.push(id);
const index = {
  about:
    "Static plugin registry (plan 11.2, W1.20, W4.32), built by scripts/build-plugin-registry.mjs: one folder per version; every version listed here is scanned (scripts/scan-plugins.mjs → scan.json); a version whose scan fails is not shown.",
  plugins: order.map((id) => {
    const versions = [...found.get(id)].sort((a, b) => semverCmp(a.version, b.version));
    // W11.S14: a takedown (review-plugins.mjs --takedown) stays until the version's folder is removed.
    const before = previous.plugins.find((p) => p.id === id)?.versions ?? [];
    const delisted = (v) => before.find((b) => b.version === v.version && b.path === v.path)?.delisted;
    return { id, name: versions[versions.length - 1].name, versions: versions.map((v) => ({ version: v.version, path: v.path, sha256: v.sha256, manifestSha256: v.manifestSha256, ...(delisted(v) ? { delisted: delisted(v) } : {}) })) };
  }),
};
const out = JSON.stringify(index, null, 2) + "\n";
const stale = !existsSync(INDEX) || readFileSync(INDEX, "utf8") !== out;
console.log(`${index.plugins.length} plugins in the registry${stale ? (check ? " — index.json is out of date: run node scripts/build-plugin-registry.mjs" : " — index.json written") : ""}`);
if (!check && stale) writeFileSync(INDEX, out);

// The signature over index.json (W10.B3).
let sigProblem = false;
if (signIt) {
  const keyFile = process.env.LUMEN_PLUGIN_SIGNING_KEY;
  if (!keyFile || !existsSync(keyFile)) {
    console.log("FAIL --sign needs LUMEN_PLUGIN_SIGNING_KEY=<path to the owner's PKCS#8 PEM key> (made by --keygen)");
    process.exit(1);
  }
  const sig = signRegistryBytes(Buffer.from(out, "utf8"), readFileSync(keyFile, "utf8"));
  writeFileSync(SIG, JSON.stringify(sig, null, 2) + "\n");
  console.log(`index.json signed by ${sig.signedBy} → index.json.sig`);
} else if (existsSync(SIG)) {
  const sig = JSON.parse(readFileSync(SIG, "utf8"));
  // A pinned key from the build's trust roots wins over the copy in the .sig file.
  let pinned = null;
  try {
    pinned = JSON.parse(process.env.VITE_PLUGIN_TRUSTED_KEYS || "{}")[sig.signedBy] ?? null;
  } catch {
    pinned = null;
  }
  const spki = pinned ?? sig.publicKey;
  const verdict = spki && fingerprintOfSpki(Buffer.from(spki, "base64")) === sig.signedBy ? verifyRegistryBytes(Buffer.from(out, "utf8"), sig, spki) : "wrong-key";
  if (verdict === "ok") console.log(`index.json.sig verifies (${sig.signedBy.slice(0, 16)}…${pinned ? ", pinned key" : ", key in the .sig file only: set VITE_PLUGIN_TRUSTED_KEYS to pin it"})`);
  else {
    sigProblem = true;
    console.log(`FAIL index.json.sig does not match index.json (${verdict}): the owner re-signs with --sign`);
  }
} else {
  console.log("index.json is not signed (no index.json.sig): the app will not install from it until the owner runs --sign");
}

const scan = spawnSync(process.execPath, [join(ROOT, "scripts/scan-plugins.mjs"), ...(check ? ["--check"] : [])], { stdio: "inherit" });
process.exit((check && stale) || sigProblem ? 1 : (scan.status ?? 1));
