#!/usr/bin/env node
/**
 * The English G2P's dictionaries (plan 6.2) for the voice pack: misaki's
 * us_gold.json and us_silver.json (hexgrad/misaki, Apache-2.0) at the pinned
 * commit, in one file that src/ai/tts/englishG2P.ts's EnglishLexicon reads.
 *
 *   git clone https://github.com/hexgrad/misaki && git -C misaki checkout <MISAKI_COMMIT>
 *   node scripts/tts/build-misaki-dict.mjs --misaki misaki --out dist-models/misaki-us.json
 *
 * Refuses another commit: the pack's sha256 must stay reproducible. Prints
 * the file's sha256 and size for the voice pack's manifest.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MISAKI_COMMIT = "fba1236595f2d2bf21d414ba6e57d25256afada3";
export const MISAKI_LICENSE = "Apache-2.0";

/** The pack: both dictionaries, their source and licence. Values are checked to be strings or { DEFAULT, … } maps. */
export function buildPack(gold, silver, commit = MISAKI_COMMIT) {
  for (const [name, d] of [["gold", gold], ["silver", silver]])
    for (const [k, v] of Object.entries(d)) if (!(typeof v === "string" || (v && typeof v === "object" && "DEFAULT" in v))) throw new Error(`${name}: ${k} is neither a string nor a map with DEFAULT`);
  return { source: "https://github.com/hexgrad/misaki", commit, license: MISAKI_LICENSE, attribution: "misaki © hexgrad, Apache License 2.0: misaki/data/us_gold.json and us_silver.json", gold, silver };
}

if (process.argv[1]?.endsWith("tts/build-misaki-dict.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const dir = opt("--misaki") ?? (console.error("--misaki <checkout> is required"), process.exit(2));
  const out = opt("--out") ?? (console.error("--out <file> is required"), process.exit(2));
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== MISAKI_COMMIT) (console.error(`misaki is at ${head}; the pack is pinned to ${MISAKI_COMMIT}`), process.exit(1));
  const read = (f) => JSON.parse(readFileSync(join(dir, "misaki", "data", f), "utf8"));
  const text = JSON.stringify(buildPack(read("us_gold.json"), read("us_silver.json")));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(JSON.stringify({ out, commit: head, sha256: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text) }));
}
