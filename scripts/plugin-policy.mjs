#!/usr/bin/env node
/**
 * Sign a managed plugin policy for a shared vault (plan W13.L4).
 *
 *   node scripts/plugin-policy.mjs keygen                          # a new Ed25519 policy key (keep the .pem private)
 *   node scripts/plugin-policy.mjs sign --key policy.pem --in policy.json [--out <vault>/.lumen/plugin-policy.json]
 *   node scripts/plugin-policy.mjs check --in <vault>/.lumen/plugin-policy.json [--trust <fingerprint>]
 *
 * policy.json: { "version": 1, "name": "Class 7B", "allow": ["lumen.flashcards", "org.school.*"],
 *   "deny": [], "registries": [{ "name": "School", "url": "https://plugins.school.example/registry", "key": "<SPKI base64>" }],
 *   "onlyListedRegistries": true }
 * Each device that should honour it trusts the key's fingerprint once (Settings, or the device policy's policyKeys).
 * The signature is Ed25519 over the policy's canonical JSON (sorted keys), as src/plugins/policy.ts checks it.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicKey, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import { generateSigningKey, signRegistryBytes, fingerprintOfSpki } from "./lib/plugin-registry-sign.mjs";

/** JSON with sorted keys, undefined dropped: the bytes the signature covers (same as canonicalJson in policy.ts). */
export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
    .join(",")}}`;
}

export function signPolicy(policy, privateKeyPem) {
  const sig = signRegistryBytes(Buffer.from(canonicalJson(policy)), privateKeyPem);
  return { policy, signature: { alg: "Ed25519", publicKey: sig.publicKey, signature: sig.signature } };
}

export function checkPolicyFile(file, trusted = []) {
  const spki = Buffer.from(String(file?.signature?.publicKey ?? ""), "base64");
  const fp = fingerprintOfSpki(spki);
  let ok = false;
  try {
    ok = verify(null, Buffer.from(canonicalJson(file.policy)), createPublicKey({ key: spki, format: "der", type: "spki" }), Buffer.from(String(file.signature.signature), "base64"));
  } catch {
    ok = false;
  }
  return { ok, fingerprint: fp, trusted: trusted.includes(fp) };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (n) => (rest.indexOf(`--${n}`) >= 0 ? rest[rest.indexOf(`--${n}`) + 1] : undefined);
  if (cmd === "keygen") {
    const k = generateSigningKey();
    writeFileSync("policy-key.pem", k.privateKeyPem, { mode: 0o600 });
    console.log(`policy-key.pem written (keep it private)\nfingerprint: ${k.fingerprint}\npublic key: ${k.spkiBase64}`);
    return;
  }
  if (cmd === "sign") {
    const out = signPolicy(JSON.parse(readFileSync(opt("in"), "utf8")), readFileSync(opt("key"), "utf8"));
    const text = JSON.stringify(out, null, 2) + "\n";
    if (opt("out")) {
      mkdirSync(dirname(opt("out")), { recursive: true });
      writeFileSync(opt("out"), text);
    } else process.stdout.write(text);
    return;
  }
  if (cmd === "check") {
    const r = checkPolicyFile(JSON.parse(readFileSync(opt("in"), "utf8")), opt("trust") ? [opt("trust")] : []);
    console.log(`${r.ok ? "signature ok" : "BAD signature"} · signed by ${r.fingerprint}${opt("trust") ? (r.trusted ? " (trusted)" : " (NOT the trusted key)") : ""}`);
    process.exit(r.ok && (!opt("trust") || r.trusted) ? 0 : 1);
  }
  console.error("usage: plugin-policy.mjs keygen | sign --key <pem> --in <policy.json> [--out <file>] | check --in <file> [--trust <fingerprint>]");
  process.exit(2);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
