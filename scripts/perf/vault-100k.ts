/**
 * W2.22 — a synthetic 100,000-note vault through the vault index core, with
 * the plan's limits as assertions. For the nightly measurement:
 *
 *   npm run perf:vault100k                  # 100,000 notes, the limits below
 *   npm run perf:vault100k -- --notes 20000 # smaller
 *   npm run perf:vault100k -- --soak 1440   # 24 hours of random edits and queries
 *   npm run perf:vault100k -- --attachments /tmp/v100k --attachments-gb 5
 *                                           # + 5 GB of sparse attachments (W10.E17)
 *
 * W10.E17: "open < 2 s" is the open from the stored snapshot, measured
 * apart from the build (scripts/perf/vaultOpen.ts), and it is a limit.
 *
 * Notes are ~1.9 KB each (190M characters), two thirds Hebrew, with wiki
 * links. Run with `--expose-gc` for exact heap numbers (the npm script does).
 * Prints one JSON line and exits non-zero when a limit is broken.
 */
import { VaultIndex } from "../../src/storage/vaultIndexCore";
import { measureOpen, OPEN_LIMIT_MS } from "./vaultOpen";
// @ts-expect-error — plain .mjs module without type declarations
import { makeSparseAttachments } from "./sparseAttachments.mjs";

const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const N = arg("notes", 100_000);
const SOAK_MIN = arg("soak", 0);
const LIMITS = { searchMs: 200, saveToIndexMs: 50, heapMB: 1500, openMs: OPEN_LIMIT_MS };
const ATTACH_DIR = (() => {
  const i = process.argv.indexOf("--attachments");
  return i > 0 ? process.argv[i + 1] : null;
})();
const ATTACH_GB = arg("attachments-gb", 5);

const HE = "שלום עולם הבית הגדול ספר מחברת ירושלים תל אביב פגישה מחר בבוקר רשימת משימות סיכום הרצאה מבחן".split(" ");
const EN = "the quick brown fox project meeting notes summary lumen editor markdown vault search index graph".split(" ");
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function note(i: number): string {
  const W = i % 3 !== 0 ? HE : EN;
  const words: string[] = [];
  const len = 150 + Math.floor(rnd() * 300);
  for (let k = 0; k < len; k++) words.push(W[Math.floor(rnd() * W.length)]);
  for (let k = 0; k < 3; k++) words.push(`[[note-${Math.floor(rnd() * N)}]]`);
  return `# Note ${i}\n\n${words.join(" ")} unique${i}\n`;
}
const gc = (globalThis as { gc?: () => void }).gc;
const heapMB = () => {
  gc?.();
  return process.memoryUsage().heapUsed / 1e6;
};
const time = <T,>(fn: () => T): [number, T] => {
  const t = performance.now();
  const r = fn();
  return [performance.now() - t, r];
};

const h0 = heapMB();
const idx = new VaultIndex();
const [buildMs] = time(() => {
  for (let i = 0; i < N; i++) idx.upsert({ path: `f${i % 100}/note-${i}.md`, name: `note-${i}.md`, content: note(i), modified: i });
});
const heap = heapMB() - h0;
const queries = ["unique" + (N - 1), "ירושלים", "הבית", "lumen editor", "qqqq"];
const search = Object.fromEntries(queries.map((q) => [q, Math.round(time(() => idx.search(q))[0])]));
// A save: re-index one note (VaultIndex on this train has no prepare() step,
// which 122d8f7381 had and this script still called); then the note is found.
const [saveToIndexMs] = time(() => {
  idx.upsert({ path: "f1/note-1.md", name: "note-1.md", content: note(1) + " savedmarker", modified: Date.now() });
});
const hits = idx.search("savedmarker").length;

// W10.E17: open from the snapshot the app stores (not the build above).
const open = measureOpen(
  Array.from({ length: N }, (_, i) => ({ path: `f${i % 100}/note-${i}.md`, name: `note-${i}.md`, content: note(i), modified: i })),
  `f${(N - 1) % 100}/note-${N - 1}.md`,
);
const attachments = ATTACH_DIR ? makeSparseAttachments(ATTACH_DIR, Math.round(ATTACH_GB * 1024 ** 3), 500) : null;

const result = {
  notes: N,
  buildMs: Math.round(buildMs),
  heapMB: Math.round(heap),
  searchMs: search,
  saveToIndexMs: Math.round(saveToIndexMs * 10) / 10,
  saveFound: hits === 1,
  openMs: Math.round(open.openMs),
  openPhases: Object.fromEntries(Object.entries(open.phases).map(([k, v]) => [k, Math.round(v)])),
  openIndexMs: Math.round(open.indexMs),
  attachments: attachments ? { files: attachments.files.length, apparentGB: +(attachments.apparentBytes / 1024 ** 3).toFixed(2), allocatedMB: +(attachments.allocatedBytes / 1024 ** 2).toFixed(1) } : null,
  soak: null as null | { minutes: number; ops: number; errors: number; heapMB: number },
};

if (SOAK_MIN > 0) {
  const end = Date.now() + SOAK_MIN * 60_000;
  let ops = 0;
  let errors = 0;
  while (Date.now() < end) {
    try {
      const i = Math.floor(rnd() * N);
      const r = rnd();
      if (r < 0.6) idx.upsert({ path: `f${i % 100}/note-${i}.md`, name: `note-${i}.md`, content: note(i), modified: ops });
      else if (r < 0.7) idx.remove(`f${i % 100}/note-${i}.md`);
      else if (r < 0.95) idx.search(rnd() < 0.5 ? HE[i % HE.length] : EN[i % EN.length]);
      else idx.backlinks(`note-${i}.md`);
    } catch {
      errors++;
    }
    ops++;
  }
  result.soak = { minutes: SOAK_MIN, ops, errors, heapMB: Math.round(heapMB() - h0) };
}

console.log(JSON.stringify(result));
const worst = Math.max(...Object.values(search));
const broken = [
  worst > LIMITS.searchMs && `search ${worst} ms > ${LIMITS.searchMs}`,
  saveToIndexMs > LIMITS.saveToIndexMs && `save → index ${saveToIndexMs.toFixed(1)} ms > ${LIMITS.saveToIndexMs}`,
  heap > LIMITS.heapMB && `heap ${Math.round(heap)} MB > ${LIMITS.heapMB}`,
  !result.saveFound && "a saved note was not found",
  open.openMs > LIMITS.openMs && `open ${Math.round(open.openMs)} ms > ${LIMITS.openMs}`,
  result.soak && result.soak.errors > 0 && `${result.soak.errors} errors in the soak`,
].filter(Boolean);
if (broken.length) {
  console.error("vault-100k: " + broken.join("; "));
  process.exit(1);
}
