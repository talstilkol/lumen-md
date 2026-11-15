/**
 * The merge engine (plan W1.9, src/sync/merge/textMerge.ts) measured on
 * public, real editing traces instead of pairs we generated (plan W11.S7,
 * research R3.8):
 *
 *   - josephg/editing-traces, sequential_traces/*.json.gz: keystroke-level
 *     histories of real documents ({ startContent, endContent, txns: [{ patches:
 *     [[pos, deleted, inserted]] }] }, positions in code points)
 *   - dmonad/crdt-benchmarks B4 (js-lib/b4-editing-trace.js): Martin
 *     Kleppmann's automerge-paper trace as `export const edits = [[pos, del, 'c'], …]`
 *     and `export const finalText = "…"`; read as text, never executed
 *
 * A trace is one author editing in sequence. To get concurrent pairs, it is
 * cut at a checkpoint k: base = the document after k transactions; "ours" =
 * base + the next W transactions; "theirs" = base + the W after those, as if
 * typed on a second device that never saw ours. Those second-window edits
 * were made on a document that did contain ours, so where one depends on
 * ours it is adapted the way a second device would have to make it:
 *   - an insert typed right after text ours inserted is kept where it is in
 *     the sequence (on the other device it lands at the same place: a
 *     same-place concurrent insert, the hard case) and counted as re-anchored;
 *   - a delete of text ours inserted is dropped (the other device never had
 *     that text) and counted.
 * The expected merge keeps every character that neither side deleted.
 *
 * For each pair the real mergeText runs, and the pair is "merged" (clean, no
 * dialog) or "dialog" (an overlap left). For a merged pair, "lost" counts the
 * characters the expected merge has and the merge does not, and "extra" the
 * reverse (both by character multiset, so a same-place insert in either
 * order counts as nothing lost). "exact" says the merge equals the expected
 * text in the sequence's order.
 *
 * A split pair with a re-anchored insert or a dropped delete is "dependent":
 * its second window edited what the first wrote, which no second device
 * could have done, so its expected text is only a model. Its merge still
 * counts for merged/dialog, but characters it is off by are reported apart
 * (dependentLostChars), not as lost. The real concurrent pairs have no such
 * modelling: their expected text is what the users really ended up with.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export type Patch = [pos: number, del: number, ins: string];
export interface Trace {
  name: string;
  startContent: string;
  endContent: string;
  txns: Patch[][];
}

/** The window length (transactions per side) of the headline number. Fixed before the first run; never tuned. */
export const PRIMARY_WINDOW = 200;
/** Other window lengths reported alongside, for sensitivity. */
export const SENSITIVITY_WINDOWS = [50, 1000];
/** Pairs per trace. */
export const PAIRS_PER_TRACE = 100;
/** The acceptance of W11.S7: ≥ 90 % merged without a dialog, 0 characters lost. Never lower it. */
export const ACCEPT = Object.freeze({ mergedRate: 0.9, lost: 0 });

export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/* ─── loaders ────────────────────────────────────────────────────────── */

/** A josephg/editing-traces file (gzipped or not). */
export function parseEditingTrace(bytes: Uint8Array, name: string): Trace {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : Buffer.from(bytes);
  const j = JSON.parse(raw.toString("utf8"));
  if (typeof j?.endContent !== "string" || !Array.isArray(j.txns)) throw new Error(`${name}: not an editing-traces file (no endContent or txns)`);
  const txns: Patch[][] = j.txns.map((t: { patches?: unknown[] }, i: number) => {
    if (!Array.isArray(t.patches) || t.patches.length === 0) throw new Error(`${name}: txn ${i} has no patches`);
    return t.patches.map((p) => {
      const [pos, del, ins] = p as [number, number, string];
      if (!Number.isInteger(pos) || !Number.isInteger(del) || typeof (ins ?? "") !== "string") throw new Error(`${name}: txn ${i}: bad patch ${JSON.stringify(p)}`);
      return [pos, del, ins ?? ""] as Patch;
    });
  });
  return { name, startContent: j.startContent ?? "", endContent: j.endContent, txns };
}

/** Decode one JS string literal body (between the quotes): \\, \', \", \n, \t, \r, \b, \f, \v, \0, \xHH, \uHHHH, \u{…}, line continuations. */
export function decodeJsString(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = body[++i];
    switch (n) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "0": out += "\0"; break;
      case "\n": break;
      case "x": out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16)); i += 2; break;
      case "u":
        if (body[i + 1] === "{") {
          const end = body.indexOf("}", i);
          out += String.fromCodePoint(parseInt(body.slice(i + 2, end), 16));
          i = end;
        } else {
          out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16));
          i += 4;
        }
        break;
      default: out += n; // \\ \' \" and any other escaped character stand for themselves
    }
  }
  return out;
}

/**
 * crdt-benchmarks' b4-editing-trace.js, read as text (it is never imported
 * or evaluated): `finalText` and `edits`, one transaction per edit.
 */
export function parseB4(text: string, name = "crdt-benchmarks-b4"): Trace {
  const ft = /export const finalText = "((?:[^"\\]|\\[\s\S])*)"/.exec(text);
  const at = text.indexOf("export const edits = [");
  if (!ft || at < 0) throw new Error(`${name}: no finalText or edits export`);
  const txns: Patch[][] = [];
  // Inserted text is single-quoted, or double-quoted when it holds a ' (prettier's choice).
  const re = /\[(\d+), (\d+)(?:, (?:'((?:[^'\\]|\\[\s\S])*)'|"((?:[^"\\]|\\[\s\S])*)"))?\]/g;
  re.lastIndex = at;
  const end = text.indexOf("\n]", at);
  for (let m = re.exec(text); m && m.index < end; m = re.exec(text)) txns.push([[Number(m[1]), Number(m[2]), decodeJsString(m[3] ?? m[4] ?? "")]]);
  return { name, startContent: "", endContent: decodeJsString(ft[1]), txns };
}

/** Apply patches to a document (an array of single characters). */
function applyPatches(doc: string[], patches: readonly Patch[]) {
  for (const [pos, del, ins] of patches) doc.splice(pos, del, ...Array.from(ins));
}

/** Replay a whole trace; throws when it does not end at endContent. */
export function replay(trace: Trace): string {
  const doc = Array.from(trace.startContent);
  for (const t of trace.txns) applyPatches(doc, t);
  const out = doc.join("");
  if (out !== trace.endContent) throw new Error(`${trace.name}: replay does not give endContent (${out.length} vs ${trace.endContent.length} chars)`);
  return out;
}

/* ─── concurrent pairs ───────────────────────────────────────────────── */

export interface Pair {
  trace: string;
  at: number;
  window: number;
  base: string;
  ours: string;
  theirs: string;
  /** Every character neither side deleted, in the sequence's order. */
  expected: string;
  /** Second-window inserts typed right after text the first window inserted. */
  reanchored: number;
  /** Second-window deletes of text the first window inserted (dropped). */
  droppedDeletes: number;
}

export interface Item {
  ch: string;
  /** 0 base, 1 ours (first window), 2 theirs (second window). */
  o: 0 | 1 | 2;
  delOurs: boolean;
  delTheirs: boolean;
}

/**
 * Every character of a pair in one list (base's, and what each window
 * inserted), with who inserted and who deleted it; base, ours, theirs and
 * expected are all projections of it (projectItems).
 */
export function pairItems(base: readonly string[], first: readonly Patch[][], second: readonly Patch[][]): { items: Item[]; reanchored: number; droppedDeletes: number } {
  const all: Item[] = base.map((ch) => ({ ch, o: 0, delOurs: false, delTheirs: false }));
  // What the author saw while typing: the sequence's document (a dropped delete is still gone here).
  const seen: Item[] = all.slice();
  let reanchored = 0;
  let droppedDeletes = 0;
  const apply = (side: 1 | 2, patches: readonly Patch[]) => {
    for (const [pos, del, ins] of patches) {
      for (const it of seen.slice(pos, pos + del)) {
        if (side === 2 && it.o === 1) droppedDeletes++;
        else if (side === 1) it.delOurs = true;
        else it.delTheirs = true;
      }
      seen.splice(pos, del);
      if (!ins) continue;
      const anchor = pos > 0 ? seen[pos - 1] : null;
      if (side === 2 && anchor?.o === 1) reanchored++;
      const items: Item[] = Array.from(ins, (ch) => ({ ch, o: side, delOurs: false, delTheirs: false }));
      const i = anchor ? all.indexOf(anchor) + 1 : 0;
      all.splice(i, 0, ...items);
      seen.splice(pos, 0, ...items);
    }
  };
  for (const t of first) apply(1, t);
  for (const t of second) apply(2, t);
  return { items: all, reanchored, droppedDeletes };
}

/** The four texts of a pair's item list (or of any subset of it, in order). */
export function projectItems(items: readonly Item[]): Pick<Pair, "base" | "ours" | "theirs" | "expected"> {
  const text = (keep: (it: Item) => boolean) => items.filter(keep).map((it) => it.ch).join("");
  return {
    base: text((it) => it.o === 0),
    ours: text((it) => it.o !== 2 && !it.delOurs),
    theirs: text((it) => it.o !== 1 && !it.delTheirs),
    expected: text((it) => !it.delOurs && !it.delTheirs),
  };
}

/** One pair from `base` (array of chars) and the two windows of transactions. */
export function makePair(trace: string, at: number, window: number, base: readonly string[], first: readonly Patch[][], second: readonly Patch[][]): Pair {
  const { items, reanchored, droppedDeletes } = pairItems(base, first, second);
  return { trace, at, window, ...projectItems(items), reanchored, droppedDeletes };
}

/**
 * The smallest subset of a pair's items (whole lines dropped first, then
 * single characters) on which a clean merge still loses characters, with
 * the three versions still different (a real three-way merge). Every text
 * of the result is a projection of the same subset, so its expected text is
 * exact. Used to derive the committed regression fixtures from the real
 * traces (scripts/bench/merge-traces-shrink.ts); null when nothing is lost.
 */
export function shrinkLoss(items: readonly Item[], merge: MergeFn): Item[] | null {
  const lostOf = (xs: readonly Item[]) => {
    const c = projectItems(xs);
    if (c.ours === c.theirs || c.ours === c.base || c.theirs === c.base) return 0;
    return classify({ trace: "", at: 0, window: 0, ...c, reanchored: 0, droppedDeletes: 0 }, merge).lost;
  };
  if (lostOf(items) === 0) return null;
  let cur: Item[][] = [];
  let g: Item[] = [];
  for (const it of items) {
    g.push(it);
    if (it.ch === "\n") {
      cur.push(g);
      g = [];
    }
  }
  if (g.length) cur.push(g);
  const pass = () => {
    for (let size = Math.ceil(cur.length / 2); size >= 1; size = size === 1 ? 0 : Math.ceil(size / 2)) {
      for (let s = 0; s < cur.length; ) {
        const next = [...cur.slice(0, s), ...cur.slice(s + size)];
        if (next.length && lostOf(next.flat()) > 0) cur = next;
        else s += size;
      }
    }
  };
  pass();
  cur = cur.flat().map((it) => [it]);
  pass();
  return cur.flat();
}

/**
 * `count` pairs of `window` transactions per side, at evenly spaced
 * checkpoints through the trace (deterministic: no randomness).
 */
export function makePairs(trace: Trace, window: number, count = PAIRS_PER_TRACE): Pair[] {
  const T = trace.txns.length;
  if (T < 2 * window + 1) return [];
  const checkpoints = new Set<number>();
  for (let i = 0; i < count; i++) checkpoints.add(Math.floor(((i + 1) * (T - 2 * window)) / (count + 1)));
  const doc = Array.from(trace.startContent);
  const out: Pair[] = [];
  let k = 0;
  for (const at of [...checkpoints].sort((a, b) => a - b)) {
    for (; k < at; k++) applyPatches(doc, trace.txns[k]);
    out.push(makePair(trace.name, at, window, doc, trace.txns.slice(at, at + window), trace.txns.slice(at + window, at + 2 * window)));
  }
  return out;
}

/* ─── classification ─────────────────────────────────────────────────── */

export type MergeFn = (base: string, ours: string, theirs: string) => { clean: boolean; text: string };

export interface Outcome {
  merged: boolean;
  lost: number;
  extra: number;
  exact: boolean;
}

/** Characters `want` has more of than `got` (multiset difference size). */
function missing(want: string, got: string): number {
  // Only the differing middle matters; trim the common prefix and suffix first.
  let a = 0;
  while (a < want.length && a < got.length && want[a] === got[a]) a++;
  let b = 0;
  while (b < want.length - a && b < got.length - a && want[want.length - 1 - b] === got[got.length - 1 - b]) b++;
  const c = new Map<string, number>();
  for (const ch of want.slice(a, want.length - b)) c.set(ch, (c.get(ch) ?? 0) + 1);
  for (const ch of got.slice(a, got.length - b)) c.set(ch, (c.get(ch) ?? 0) - 1);
  let n = 0;
  for (const v of c.values()) if (v > 0) n += v;
  return n;
}

export function classify(p: Pair, merge: MergeFn): Outcome {
  const m = merge(p.base, p.ours, p.theirs);
  if (!m.clean) return { merged: false, lost: 0, extra: 0, exact: false };
  return { merged: true, lost: missing(p.expected, m.text), extra: missing(m.text, p.expected), exact: m.text === p.expected };
}

export interface Tally {
  pairs: number;
  merged: number;
  dialog: number;
  /** Characters lost in clean merges of independent pairs (the acceptance counts these). */
  lostChars: number;
  extraChars: number;
  pairsWithLoss: number;
  exact: number;
  reanchored: number;
  droppedDeletes: number;
  /**
   * Split pairs whose second window edited text the first window wrote (a
   * re-anchored insert or a dropped delete). One author made both windows,
   * so these are not truly concurrent, and the expected text is only a model:
   * their characters lost or extra are reported here and not in lostChars.
   */
  dependentPairs: number;
  dependentLostChars: number;
  dependentPairsWithLoss: number;
  mergedRate: number;
}

export const isDependent = (p: Pick<Pair, "reanchored" | "droppedDeletes">) => p.reanchored > 0 || p.droppedDeletes > 0;

export function tally(pairs: readonly Pair[], outcomes: readonly Outcome[]): Tally {
  const merged = outcomes.filter((o) => o.merged).length;
  const ind = outcomes.filter((_, i) => !isDependent(pairs[i]));
  const dep = outcomes.filter((_, i) => isDependent(pairs[i]));
  return {
    pairs: pairs.length,
    merged,
    dialog: pairs.length - merged,
    lostChars: ind.reduce((s, o) => s + o.lost, 0),
    extraChars: ind.reduce((s, o) => s + o.extra, 0),
    pairsWithLoss: ind.filter((o) => o.lost > 0).length,
    exact: outcomes.filter((o) => o.exact).length,
    reanchored: pairs.reduce((s, p) => s + p.reanchored, 0),
    droppedDeletes: pairs.reduce((s, p) => s + p.droppedDeletes, 0),
    dependentPairs: dep.length,
    dependentLostChars: dep.reduce((s, o) => s + o.lost, 0),
    dependentPairsWithLoss: dep.filter((o) => o.lost > 0).length,
    mergedRate: pairs.length ? merged / pairs.length : 0,
  };
}

/** Does a tally meet ≥ 90 % merged and 0 lost (independent pairs) on its own? Reported per measurement. */
export const accepted = (t: Tally) => t.pairs > 0 && t.mergedRate >= ACCEPT.mergedRate && t.lostChars <= ACCEPT.lost;

/* ─── the gate (coordinator decision for W11.S7, 15.11) ──────────────── */

/**
 * What W11.S7's acceptance gates, as the coordinator decided it:
 *
 *   1. the REAL concurrent pairs (concurrent_traces) merge without a dialog
 *      in ≥ 90 % (ACCEPT.mergedRate);
 *   2. zero characters are lost on EVERY pair kind: the real pairs, and the
 *      split pairs at every window and in every set, dependent pairs
 *      included (a clean merge that drops a character is a bug whatever the
 *      pair, so dependentLostChars counts here too). This is an invariant.
 *
 * The split's merged rate (10.4 % at W = 200) is reported, not gated: one
 * author's two consecutive windows are mostly dependent by construction.
 */
export const GATE = Object.freeze({
  realMergedRate: ACCEPT.mergedRate,
  lostOnEveryPairKind: ACCEPT.lost,
  splitMergedRateGated: false,
});

export interface Verdict {
  realMergedRate: number;
  /** Characters lost in clean merges, by pair kind. */
  lost: { real: number; splitIndependent: number; splitDependent: number };
  /** Pairs with a loss, every kind together. */
  pairsWithLoss: number;
  met: boolean;
}

/**
 * The gate's verdict. `split` is every split tally measured (each window,
 * each set); the real total alone carries the merged-rate gate.
 */
export function verdict(real: Tally, split: readonly Tally[]): Verdict {
  const lost = {
    real: real.lostChars + real.dependentLostChars,
    splitIndependent: split.reduce((s, t) => s + t.lostChars, 0),
    splitDependent: split.reduce((s, t) => s + t.dependentLostChars, 0),
  };
  const pairsWithLoss = real.pairsWithLoss + real.dependentPairsWithLoss + split.reduce((s, t) => s + t.pairsWithLoss + t.dependentPairsWithLoss, 0);
  const allLost = lost.real + lost.splitIndependent + lost.splitDependent;
  return { realMergedRate: real.mergedRate, lost, pairsWithLoss, met: real.pairs > 0 && real.mergedRate >= GATE.realMergedRate && allLost <= GATE.lostOnEveryPairKind };
}

/* ─── real concurrent pairs (concurrent_traces) ──────────────────────── */

export interface ConcurrentTrace {
  name: string;
  endContent: string;
  numAgents: number;
  txns: Array<{ parents: number[]; agent: number; patches: Patch[] }>;
}

/** A josephg/editing-traces concurrent_traces file (gzipped or not). */
export function parseConcurrentTrace(bytes: Uint8Array, name: string): ConcurrentTrace {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : Buffer.from(bytes);
  const j = JSON.parse(raw.toString("utf8"));
  if (j?.kind !== "concurrent" || !Array.isArray(j.txns) || !Number.isInteger(j.numAgents)) throw new Error(`${name}: not a concurrent editing trace`);
  return {
    name,
    endContent: j.endContent,
    numAgents: j.numAgents,
    txns: j.txns.map((t: { parents: number[]; agent: number; patches?: unknown[] }) => ({ parents: t.parents, agent: t.agent, patches: (t.patches ?? []).map((p) => [(p as Patch)[0], (p as Patch)[1], (p as Patch)[2] ?? ""] as Patch) })),
  };
}

/**
 * Replays a concurrent trace. Each agent's transactions are totally ordered
 * (a rule of the data set), so a version is a vector of per-agent counts.
 * Every character ever inserted is kept in one list with who inserted and
 * who deleted it; the text at a version is the characters visible in it.
 */
export class ConcurrentReplay {
  readonly ch: string[] = [];
  readonly insAgent: number[] = [];
  readonly insSeq: number[] = [];
  /** Deleters as [agent, seq] pairs, flattened; null when never deleted. */
  readonly del: Array<number[] | null> = [];
  /** The version after each transaction. */
  readonly versions: Int32Array[] = [];
  readonly seqOf: number[] = [];

  constructor(readonly trace: ConcurrentTrace) {
    const n = trace.numAgents;
    const count = new Array(n).fill(0);
    trace.txns.forEach((t, i) => {
      const v = new Int32Array(n);
      for (const p of t.parents) for (let a = 0; a < n; a++) v[a] = Math.max(v[a], this.versions[p][a]);
      this.apply(t, v, count[t.agent] + 1);
      count[t.agent]++;
      this.seqOf[i] = count[t.agent];
      v[t.agent] = count[t.agent];
      this.versions.push(v);
    });
  }

  private visibleAt(i: number, v: Int32Array) {
    if (this.insSeq[i] > v[this.insAgent[i]]) return false;
    const d = this.del[i];
    if (d) for (let k = 0; k < d.length; k += 2) if (d[k + 1] <= v[d[k]]) return false;
    return true;
  }

  /** Indices (into the global list) of the characters visible at `v`. */
  visible(v: Int32Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.ch.length; i++) if (this.visibleAt(i, v)) out.push(i);
    return out;
  }

  text(v: Int32Array): string {
    return this.visible(v).map((i) => this.ch[i]).join("");
  }

  private apply(t: { agent: number; patches: Patch[] }, v: Int32Array, seq: number) {
    let vis = this.visible(v);
    for (const [pos, delN, ins] of t.patches) {
      for (const i of vis.slice(pos, pos + delN)) (this.del[i] ??= []).push(t.agent, seq);
      vis.splice(pos, delN);
      if (!ins) continue;
      // After the visible character before the cursor. The data set has no
      // concurrent inserts at one place, so nothing else competes for the spot.
      const at = pos > 0 ? vis[pos - 1] + 1 : 0;
      const chars = Array.from(ins);
      this.ch.splice(at, 0, ...chars);
      this.insAgent.splice(at, 0, ...chars.map(() => t.agent));
      this.insSeq.splice(at, 0, ...chars.map(() => seq));
      this.del.splice(at, 0, ...chars.map(() => null));
      // Indices at or after `at` moved by chars.length.
      vis = vis.map((i) => (i >= at ? i + chars.length : i));
      vis.splice(pos, 0, ...chars.map((_, k) => at + k));
    }
  }

  /** The whole trace's final text (must be endContent). */
  finalText(): string {
    return this.text(this.versions[this.versions.length - 1]);
  }
}

export interface ConcurrentPair {
  trace: string;
  /** The merge transaction whose parents are the two concurrent heads. */
  at: number;
  base: string;
  ours: string;
  theirs: string;
  /** What the two users really ended up with: both heads merged. */
  expected: string;
}

/**
 * The real concurrent pairs: at each transaction with two or more parents
 * (the moment two users' concurrent edits met), its first two parents are
 * ours and theirs, their common history is base, and both histories
 * together is the expected merge.
 */
export function concurrentPairs(r: ConcurrentReplay): ConcurrentPair[] {
  const out: ConcurrentPair[] = [];
  r.trace.txns.forEach((t, i) => {
    if (t.parents.length < 2) return;
    const [a, b] = t.parents.map((p) => r.versions[p]);
    const meet = a.map((x, k) => Math.min(x, b[k])) as Int32Array;
    const join = a.map((x, k) => Math.max(x, b[k])) as Int32Array;
    out.push({ trace: r.trace.name, at: i, base: r.text(meet), ours: r.text(a), theirs: r.text(b), expected: r.text(join) });
  });
  return out;
}

/** classify() for a real pair: the same counting, against the real merged state. */
export function classifyConcurrent(p: ConcurrentPair, merge: MergeFn): Outcome {
  return classify({ trace: p.trace, at: p.at, window: 0, base: p.base, ours: p.ours, theirs: p.theirs, expected: p.expected, reanchored: 0, droppedDeletes: 0 }, merge);
}
