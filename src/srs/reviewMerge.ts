/**
 * Merging the review file of two devices (plan W3.3: "the data survives
 * sync and a device switch"). `.lumen/review.json` is one JSON file that
 * every review rewrites, so two devices that each reviewed cards since the
 * last sync both changed it. A line merge of that JSON either conflicts
 * (the same card on both) or, worse, merges cleanly into something that is
 * no longer valid JSON — and a damaged review file is never overwritten,
 * so the review would stop. This merges it card by card instead:
 *
 *  - a card reviewed on both sides keeps the schedule of the later review
 *    (`card.last`; on a tie, more reviews, then this device's), and the
 *    ratings of both sides (by time, the newest 20);
 *  - a card added on one side is added; removed on one side and untouched
 *    on the other is removed; removed on one side and reviewed on the other
 *    is kept;
 *  - `gone` (the card's source left the vault) follows the side that
 *    changed it; the text follows the side whose schedule wins;
 *  - `introduced` is the earlier of the two.
 *
 * Always clean: the result is a valid review file. Pure; no imports at
 * runtime, so the git pull that calls it stays small.
 */
import type { Entry, ReviewFile } from "./cards";

export const REVIEW_FILE_PATH = ".lumen/review.json";

function parse(text: string | null): ReviewFile | null {
  if (text === null || text === "") return { version: 1, cards: {} };
  try {
    const v = JSON.parse(text) as Partial<ReviewFile>;
    return v.version === 1 && v.cards && typeof v.cards === "object" ? (v as ReviewFile) : null;
  } catch {
    return null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Which side's schedule is newer: >0 ours, <0 theirs. */
function newer(o: Entry, t: Entry): number {
  const ol = o.card.last ?? "";
  const tl = t.card.last ?? "";
  if (ol !== tl) return ol > tl ? 1 : -1;
  if (o.card.reps !== t.card.reps) return o.card.reps - t.card.reps;
  return 1;
}

function mergeEntry(base: Entry | undefined, o: Entry, t: Entry): Entry {
  if (same(o, t)) return o;
  if (base && same(base, o)) return t;
  if (base && same(base, t)) return o;
  const win = newer(o, t) > 0 ? o : t;
  const seen = new Set<string>();
  const log = [...o.log, ...t.log]
    .filter((r) => {
      const k = `${r.at}|${r.rating}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(-20);
  const introduced = [o.introduced, t.introduced].filter((x): x is string => !!x).sort()[0];
  const gone = base && o.gone === base.gone ? t.gone : o.gone;
  const out: Entry = { ...win, log, ...(introduced ? { introduced } : {}) };
  if (gone) out.gone = true;
  else delete out.gone;
  return out;
}

/**
 * The merged review file, or null when one side is not a review file (then
 * the caller falls back to its text merge, which keeps both versions).
 */
export function mergeReviewFiles(baseText: string | null, oursText: string, theirsText: string): string | null {
  const base = parse(baseText) ?? { version: 1 as const, cards: {} };
  const ours = parse(oursText);
  const theirs = parse(theirsText);
  if (!ours || !theirs) return null;
  const ids = [...new Set([...Object.keys(ours.cards), ...Object.keys(theirs.cards)])].sort();
  const cards: Record<string, Entry> = {};
  for (const id of ids) {
    const b = base.cards[id];
    const o = ours.cards[id];
    const t = theirs.cards[id];
    if (o && t) cards[id] = mergeEntry(b, o, t);
    else if (o) {
      // Theirs removed it: gone only if ours did not change it since the base.
      if (!(b && same(b, o))) cards[id] = o;
    } else if (t) {
      if (!(b && same(b, t))) cards[id] = t;
    }
  }
  return JSON.stringify({ version: 1, cards }, null, 1) + "\n";
}
