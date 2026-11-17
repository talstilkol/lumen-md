/**
 * Harness for the unlinked-mentions golden set (plan 4.6, 7.10): the app's
 * finder (src/lib/unlinkedMentions.ts, the backlinks panel's) on each
 * note's text and the vault's titles, the note's own title excluded.
 *
 *   score({ items }) → {
 *     "precision"  share of found mentions that match a labelled one (start, end and target)
 *     "recall"     share of labelled mentions found
 *     "f1"
 *     "notes.exact" share of notes whose mentions are found exactly (no miss, no extra)
 *     "mentions"    labelled mentions scored
 *   }
 *
 * Dev split: `node scripts/golden/evals/unlinked.mjs --dev`; the test split
 * runs through scripts/golden/run-evals.mjs.
 */

const key = (m) => `${m.start}:${m.end}:${m.target}`;

/** Score `find(text, titles, ownTitle) → [{ start, end, target }]` on the items. */
export async function scoreWith(find, items) {
  let gold = 0;
  let found = 0;
  let hit = 0;
  let exact = 0;
  for (const it of items) {
    const want = new Set((it.mentions ?? []).map(key));
    const got = new Set((await find(it.text, it.titles ?? [], it.title)).map(key));
    gold += want.size;
    found += got.size;
    let h = 0;
    for (const g of got) if (want.has(g)) h++;
    hit += h;
    if (h === want.size && h === got.size) exact++;
  }
  const r = (x) => Math.round(x * 10000) / 10000;
  const p = found ? hit / found : 1;
  const rc = gold ? hit / gold : 1;
  return { precision: r(p), recall: r(rc), f1: r(p + rc ? (2 * p * rc) / (p + rc) : 0), "notes.exact": r(items.length ? exact / items.length : 0), mentions: gold };
}

async function loadFind() {
  const { tsImport } = await import("tsx/esm/api");
  const m = await tsImport("../../../src/lib/unlinkedMentions.ts", import.meta.url);
  return (text, titles, own) => m.findUnlinkedMentions(text, titles, own);
}

export async function score({ items }) {
  return scoreWith(await loadFind(), items);
}

if (process.argv[1]?.endsWith("evals/unlinked.mjs") && process.argv.includes("--dev")) {
  const { loadSet } = await import("../../lib/golden.mjs");
  const { GOLDEN } = await import("../common.mjs");
  const { items } = loadSet(GOLDEN, "unlinked", { split: "dev" });
  console.log(JSON.stringify({ set: "unlinked", split: "dev", items: items.length, ...(await score({ items })) }, null, 2));
}
