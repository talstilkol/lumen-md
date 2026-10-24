#!/usr/bin/env node
// Packs this plugin into dist/<id>-<version>.lumenplugin.json — the file you
// install in Lumen (Plugins → Install from file…) or submit to a registry.
//   node pack.mjs [--key ed25519-private.pem]
// With --key the bundle is signed (Ed25519 over JSON.stringify([manifestText, mainText])).
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const keyPath = args.includes("--key") ? args[args.indexOf("--key") + 1] : null;
const manifestText = readFileSync("lumen-plugin.json", "utf8");
const m = JSON.parse(manifestText);
const main = readFileSync(m.main, "utf8");
const payload = Buffer.from(JSON.stringify([manifestText, main]), "utf8");
const out = { format: "lumen-plugin/1", manifest: manifestText, main };
if (keyPath) {
  const key = createPrivateKey(readFileSync(keyPath));
  out.signature = sign(null, payload, key).toString("base64");
  out.signedBy = createHash("sha256").update(createPublicKey(key).export({ type: "spki", format: "der" })).digest("hex");
}
mkdirSync("dist", { recursive: true });
const file = `dist/${m.id}-${m.version}.lumenplugin.json`;
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`${file}  sha256 ${createHash("sha256").update(payload).digest("hex")}${keyPath ? `  signed by ${out.signedBy.slice(0, 16)}…` : ""}`);
