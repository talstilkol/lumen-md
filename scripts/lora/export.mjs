#!/usr/bin/env node
/**
 * Plan 6.12: the app's "Export training data and script" (⌘K → AI
 * fine-tune settings…, src/ui/LocalLoraSection.tsx) from the command line,
 * so the Mac run is one command: a vault folder in, the training folder out.
 * The same code builds it — buildLoraDataset() and the scripts from
 * src/ai/localLora.ts, proseOfNote() from src/ai/styleProfiles.ts — minus
 * the user's style profile (the CLI has no app storage) and the zip.
 *
 *   node scripts/lora/export.mjs --vault <folder> --out <folder> [--folder Sub/Dir] [--platform mac|nvidia]
 *
 * Writes <out>/train.jsonl, valid.jsonl, heldout.json and train-mac.sh (or
 * train-nvidia.sh), and prints the counts as JSON (never note text).
 * Exit 1 when there is too little to train on (the app's own rule: < 10
 * training samples or no held-out note), 2 on bad arguments. Nothing is sent
 * anywhere; hidden folders (.obsidian, .trash, .git) are skipped.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readNotes } from "./readNotes.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const vault = opt("--vault");
const out = opt("--out");
const platform = opt("--platform", "mac");
const prefix = String(opt("--folder", "")).replace(/^\/+|\/+$/g, "");
if (!vault || !out || !["mac", "nvidia"].includes(platform)) {
  console.error("usage: export.mjs --vault <folder> --out <folder> [--folder Sub/Dir] [--platform mac|nvidia]");
  process.exit(2);
}

/** The app's TypeScript: through tsx when it is installed, else Node's own type stripping (22.18+). */
async function load(rel) {
  try {
    const { tsImport } = await import("tsx/esm/api");
    return await tsImport(rel, import.meta.url);
  } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND" && e?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw e;
    return import(new URL(rel, import.meta.url).href);
  }
}

const lora = await load("../../src/ai/localLora.ts");
const { proseOfNote } = await load("../../src/ai/styleProfiles.ts");
const notes = readNotes(vault).filter((n) => !prefix || n.path.startsWith(prefix + "/"));
const ds = lora.buildLoraDataset(notes, { prose: proseOfNote, profile: null });
const report = { vaultNotes: notes.length, ...ds.stats, platform, out };
if (ds.stats.trainSamples < 10 || ds.stats.heldOut < 1) {
  console.log(JSON.stringify({ ...report, ok: false, why: "too little prose to train on: need ≥ 10 training samples and ≥ 1 held-out note" }, null, 2));
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const script = platform === "mac" ? "train-mac.sh" : "train-nvidia.sh";
writeFileSync(join(out, "train.jsonl"), ds.train);
writeFileSync(join(out, "valid.jsonl"), ds.valid);
writeFileSync(join(out, "heldout.json"), JSON.stringify(ds.heldOut));
writeFileSync(join(out, script), platform === "mac" ? lora.macScript() : lora.nvidiaScript(), { mode: 0o755 });
console.log(JSON.stringify({ ...report, ok: true, files: ["train.jsonl", "valid.jsonl", "heldout.json", script] }, null, 2));
