/**
 * Plan R12.16 acceptance: "no slowdown over 5% in the search bench". The
 * search with everything R12.16 added — the transliteration keys (Kohen ↔
 * כהן, a lazily built phonetic map in Bm25Index) and the "matched as …" line
 * for the results on screen — against the same index with both switched off,
 * on 10,000 synthetic notes (Hebrew and English words, a seeded generator,
 * no Math.random).
 *
 * The machine is shared, so the clock is this process's CPU time
 * (process.cpuUsage), each query is timed many times, interleaved (on, off,
 * on, off …), and the fastest sample of each query counts: the minimum is
 * what the code costs, everything above it is someone else's load. The sum
 * of the minimums is the bench. Measured 17.11 on a 2-core box at load ~25:
 * 1.13–1.15 before the matched-as memo (text/matchedAs.ts), 1.03 with it. A query that finds nothing
 * without R12.16 ("Cohen", only in Hebrew letters in the notes) is new
 * work, not a slowdown: it is timed and printed, and checked to stay
 * interactive, but it is not in the ratio.
 */
import { describe, expect, it } from "vitest";
import { Bm25Index } from "../search/bm25";
import { looseMatches } from "../text/matchedAs";

const WORDS = ["שלום", "כהן", "לפיד", "ירושלים", "חיפה", "תכנית", "מתכון", "בית", "ספר", "עבודה", "ולפיד", "הבית", "Kohen", "garden", "notes", "report", "meeting", "מיכאל", "חיים", "הרצל", "שָׁלוֹם", "ספרים"];
/** Queries the search answered before R12.16 too: the 5% is measured on these. */
const QUERIES = ["שלום", "Kohen", "ולפיד", "תוכנית", "meeting report", "חיפה בית", "ספר", "garden"];
/** Queries only R12.16 answers (nothing in the notes is spelled this way): new results, so reported, not compared. */
const NEW_ONLY = ["Cohen", "Lapid"];
const NOTES = 10_000;
const BATCH = 5; // searches per CPU-time sample (cpuUsage counts microseconds)
const ON_SCREEN = 20; // the results the dialog shows a "matched as" line for

function corpus(): { id: string; text: string }[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  for (let i = 0; i < NOTES; i++) {
    const w: string[] = [];
    for (let j = 0; j < 60; j++) w.push(j % 7 ? WORDS[Math.floor(rnd() * WORDS.length)] : `w${Math.floor(rnd() * 5000)}`);
    out.push({ id: `n${i}`, text: w.join(" ") });
  }
  return out;
}

function index(notes: { id: string; text: string }[], r1216: boolean): Bm25Index {
  const ix = new Bm25Index();
  // why: "off" is the search without R12.16's transliteration step (the rest of the index is the same code)
  if (!r1216) (ix as unknown as { transliterations: (t: unknown[]) => unknown[] }).transliterations = () => [];
  for (const n of notes) ix.set(n.id, n.text, `note ${n.id}`);
  return ix;
}

const textOf = new Map<string, string>();
function run(ix: Bm25Index, q: string, r1216: boolean): number {
  // CPU time of this process (user + system), not the wall clock: on a shared machine the wall clock counts other jobs' turns
  const t0 = process.cpuUsage();
  for (let r = 0; r < BATCH; r++) {
    const hits = ix.search(q, { limit: 50 });
    if (r1216) for (const h of hits.slice(0, ON_SCREEN)) looseMatches(q, textOf.get(h.id) ?? "");
  }
  const d = process.cpuUsage(t0);
  return (d.user + d.system) / 1000 / BATCH;
}

describe("R12.16 search bench (10,000 notes)", () => {
  it("transliteration keys and the matched-as line cost at most 5% of the search", () => {
    const notes = corpus();
    for (const n of notes) textOf.set(n.id, n.text);
    const on = index(notes, true);
    const off = index(notes, false);
    // the work is real: Cohen (not in any note) finds כהן only with R12.16, so "off" is not a faster no-op of the same thing
    expect(on.search("Cohen", { limit: 5 }).length).toBeGreaterThan(0);
    expect(off.search("Cohen", { limit: 5 })).toEqual([]);
    for (const q of QUERIES) (run(on, q, true), run(off, q, false)); // warm: the lazy phonetic map, the JIT
    const best = (xs: number[]) => Math.min(...xs);
    let sumOn = 0;
    let sumOff = 0;
    for (const q of QUERIES) {
      const a: number[] = [];
      const b: number[] = [];
      for (let k = 0; k < 15; k++) (a.push(run(on, q, true)), b.push(run(off, q, false)));
      sumOn += best(a);
      sumOff += best(b);
    }
    for (const q of QUERIES) expect(off.search(q, { limit: 1 }).length, q).toBe(1);
    const fresh = NEW_ONLY.map((q) => {
      const a: number[] = [];
      for (let k = 0; k < 20; k++) a.push(run(on, q, true));
      expect(off.search(q, { limit: 1 }), q).toEqual([]);
      return best(a);
    });
    console.log(`R12.16 bench, new-only queries: ${NEW_ONLY.map((q, i) => `${q} ${fresh[i].toFixed(2)} ms`).join(", ")}`);
    for (const ms of fresh) expect(ms).toBeLessThan(100);
    console.log(`R12.16 bench: on ${sumOn.toFixed(2)} ms, off ${sumOff.toFixed(2)} ms, ratio ${(sumOn / sumOff).toFixed(3)} (${QUERIES.length} queries, ${NOTES} notes)`);
    expect(sumOff).toBeGreaterThan(0);
    expect(sumOn / sumOff).toBeLessThanOrEqual(1.05);
  }, 300_000);
});
