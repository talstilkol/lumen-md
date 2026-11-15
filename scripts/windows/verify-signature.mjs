#!/usr/bin/env node
/**
 * Is a Windows binary signed? (plan W11.S15)
 *
 *   node scripts/windows/verify-signature.mjs <file.exe>…
 *
 * Every platform: the file must carry an Authenticode signature (its PE
 * certificate table, scripts/lib/windowsSigning.mjs `peSignature`). On
 * Windows, also `signtool verify /pa /v <file>`, which checks the
 * signature is valid and chains to a trusted root; there, a file signtool
 * refuses fails. Exit 1 when any file is unsigned or refused.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { peSignature } from "../lib/windowsSigning.mjs";

export function verifyFile(file, { platform = process.platform, run = spawnSync } = {}) {
  const r = peSignature(readFileSync(file));
  if (!r.signed) return { name: file, signed: false, why: r.why };
  if (platform !== "win32") return { name: file, signed: true, why: `${r.why} (signtool runs on Windows only)` };
  const s = run("signtool", ["verify", "/pa", "/v", file], { encoding: "utf8" });
  if (s.status !== 0) return { name: file, signed: false, why: `signtool verify /pa refused it: ${String(s.stdout ?? s.error ?? "").trim().split("\n").slice(-2).join(" ")}` };
  return { name: file, signed: true, why: "signtool verify /pa: valid" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: verify-signature.mjs <file.exe>…");
    process.exit(2);
  }
  let bad = 0;
  for (const f of files) {
    const v = verifyFile(f);
    console.log(`${v.signed ? "✓" : "✗"} ${f}: ${v.why}`);
    if (!v.signed) bad++;
  }
  process.exit(bad ? 1 : 0);
}
