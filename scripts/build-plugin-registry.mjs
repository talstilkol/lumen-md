#!/usr/bin/env node
/**
 * Builds the first-party plugin registry (plan 11.2.4) from
 * public/plugins/examples/<name>/ (lumen-plugin.json + main):
 *   public/plugins/bundles/<id>-<version>.lumenplugin.json   (format lumen-plugin/1)
 *   public/plugins/registry.json                               (entries pinned by sha256)
 *
 *   node scripts/build-plugin-registry.mjs [--key ed25519.pem] [--check]
 *
 * --key signs every bundle (Ed25519 over the bundle payload, see
 * src/plugins/runtime/bundle.ts); the signer's fingerprint (sha256 of the
 * SPKI public key) goes in `signedBy`. --check fails when the committed
 * files are out of date (used by the unit test).
 */
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const keyPath = args.includes("--key") ? args[args.indexOf("--key") + 1] : null;
const check = args.includes("--check");
const examples = join(root, "public/plugins/examples");
const bundlesDir = join(root, "public/plugins/bundles");

const key = keyPath ? createPrivateKey(readFileSync(keyPath)) : null;
const signedBy = key ? createHash("sha256").update(createPublicKey(key).export({ type: "spki", format: "der" })).digest("hex") : null;

const entries = [];
const outputs = new Map();
for (const name of readdirSync(examples).sort()) {
  const dir = join(examples, name);
  if (!existsSync(join(dir, "lumen-plugin.json"))) continue;
  const manifestText = readFileSync(join(dir, "lumen-plugin.json"), "utf8");
  const m = JSON.parse(manifestText);
  const main = readFileSync(join(dir, m.main), "utf8");
  const payload = Buffer.from(JSON.stringify([manifestText, main]), "utf8");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const signature = key ? sign(null, payload, key).toString("base64") : undefined;
  const file = `${m.id}-${m.version}.lumenplugin.json`;
  const bundle = JSON.stringify({ format: "lumen-plugin/1", manifest: manifestText, main, ...(signature ? { signature, signedBy } : {}) }, null, 2) + "\n";
  outputs.set(join(bundlesDir, file), bundle);
  entries.push({
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    author: m.author,
    license: m.license,
    capabilities: m.capabilities.map((c) => c.id),
    bundle: `plugins/bundles/${file}`,
    sha256,
    ...(signature ? { signature, signedBy } : {}),
  });
}
const registry = JSON.stringify({ schema: 1, note: "First-party Lumen plugins. Built by scripts/build-plugin-registry.mjs from public/plugins/examples — do not edit by hand.", plugins: entries }, null, 2) + "\n";
outputs.set(join(root, "public/plugins/registry.json"), registry);

let stale = 0;
for (const [path, text] of outputs) {
  const cur = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (cur === text) continue;
  if (check) {
    stale++;
    console.error(`out of date: ${path.slice(root.length + 1)}`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
if (check && stale) {
  console.error("run: node scripts/build-plugin-registry.mjs");
  process.exit(1);
}
console.log(`plugin registry: ${entries.length} plugins${key ? `, signed by ${signedBy.slice(0, 16)}…` : ", unsigned (pinned by sha256)"}${check ? " — up to date" : ""}`);
