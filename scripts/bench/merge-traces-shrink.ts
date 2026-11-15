/**
 * Derive the merge engine's regression fixtures from the public traces
 * (plan W1.9, found by W11.S7): every split pair, at every window, on which
 * a clean merge loses characters, shrunk to a few dozen characters with
 * shrinkLoss() (merge-traces-lib.ts). Each fixture names the trace file it
 * comes from, with its pinned commit and sha256, and the pair (window and
 * checkpoint), so it can be derived again.
 *
 *   tsx scripts/bench/merge-traces-shrink.ts --from <dir> --out <file.json>
 *
 * <dir> is laid out as for merge-traces.ts --from (<set id>/<path>). Run it
 * with the engine that loses: with a fixed engine it finds nothing. The
 * concurrent pairs are not shrunk (no clean merge loses there).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeText } from "../../src/sync/merge/textMerge";
import { PAIRS_PER_TRACE, PRIMARY_WINDOW, SENSITIVITY_WINDOWS, classify, pairItems, parseB4, parseEditingTrace, projectItems, sha256, shrinkLoss, type Patch } from "./merge-traces-lib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const opt = (n: string) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const from = opt("from");
const outFile = opt("out");
if (!from || !outFile) {
  console.error("usage: merge-traces-shrink.ts --from <dir> --out <file.json>");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(root, "bench/merge-traces/manifest.json"), "utf8")) as {
  sets: Array<{ id: string; repo: string; commit: string; format: string; files: Array<{ path: string; sha256: string }> }>;
};
const fixtures: unknown[] = [];
for (const set of manifest.sets) {
  if (set.format === "concurrent") continue;
  for (const f of set.files) {
    const buf = readFileSync(join(from, set.id, f.path));
    if (sha256(buf) !== f.sha256) throw new Error(`${set.id}/${f.path}: sha256 is not the manifest's`);
    const name = f.path.split("/").pop()!.replace(/\.json\.gz$|\.js$/, "");
    const trace = set.format === "b4" ? parseB4(buf.toString("utf8"), `b4:${name}`) : parseEditingTrace(buf, name);
    for (const w of [PRIMARY_WINDOW, ...SENSITIVITY_WINDOWS]) {
      const T = trace.txns.length;
      if (T < 2 * w + 1) continue;
      const doc = Array.from(trace.startContent);
      let k = 0;
      const checkpoints = [...new Set(Array.from({ length: PAIRS_PER_TRACE }, (_, i) => Math.floor(((i + 1) * (T - 2 * w)) / (PAIRS_PER_TRACE + 1))))].sort((a, b) => a - b);
      for (const at of checkpoints) {
        for (; k < at; k++) for (const [pos, del, ins] of trace.txns[k] as Patch[]) doc.splice(pos, del, ...Array.from(ins));
        const { items, reanchored, droppedDeletes } = pairItems(doc, trace.txns.slice(at, at + w), trace.txns.slice(at + w, at + 2 * w));
        const full = classify({ trace: name, at, window: w, ...projectItems(items), reanchored, droppedDeletes }, mergeText);
        if (!full.lost) continue;
        const small = shrinkLoss(items, mergeText)!;
        const texts = projectItems(small);
        const lost = classify({ trace: name, at, window: w, ...texts, reanchored: 0, droppedDeletes: 0 }, mergeText).lost;
        fixtures.push({ source: { repo: set.repo, commit: set.commit, path: f.path, sha256: f.sha256 }, window: w, checkpoint: at, dependent: reanchored + droppedDeletes > 0, fullPairLost: full.lost, lostBefore: lost, ...texts });
        console.log(`${set.id}/${f.path} W=${w} at ${at}: ${full.lost} lost in the pair; shrunk to ${texts.base.length}/${texts.ours.length}/${texts.theirs.length} chars, ${lost} lost`);
      }
    }
  }
}
const ABOUT =
  "DERIVED from the real public editing traces named in each fixture's `source` (repo, pinned commit, file sha256), by scripts/bench/merge-traces-shrink.ts: each is a split pair (window, checkpoint) on which a clean merge lost characters before the W1.9 fix, shrunk to a subset of that pair's own characters. base/ours/theirs/expected are projections of that one subset, so expected is exact. Not written by hand; not synthetic.";
writeFileSync(outFile, JSON.stringify({ about: ABOUT, fixtures }, null, 2) + "\n");
console.log(`${fixtures.length} fixtures → ${outFile}`);
