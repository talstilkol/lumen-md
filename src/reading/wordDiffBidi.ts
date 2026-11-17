/**
 * Word-level compare of two texts, right for Hebrew and for mixed-direction
 * text (plan W13.R8).
 *
 * - Words come from `Intl.Segmenter` (granularity "word"), so every script
 *   splits the way the platform reads it; a geresh or gershayim inside a
 *   Hebrew word (צה״ל, ג'ירפה) and niqqud and cantillation marks stay in
 *   the word. Whitespace runs and punctuation are their own tokens.
 * - Options: ignore niqqud (and cantillation: U+0591–U+05C7 but the maqaf
 *   and sof pasuq), ignore whitespace differences. The text shown is
 *   always the original.
 * - The diff is Myers' O(ND) over token keys, line by line first for long
 *   texts, then word by word inside the lines that changed.
 * - A Hebrew word whose only change is its one-letter prefixes (ו, ה, ב,
 *   כ, ל, מ, ש: "הבית" → "ובית") is one change that marks only the prefix;
 *   a word whose letters are the same and only its niqqud changed is marked
 *   as a niqqud change.
 *
 * Pure: no DOM. The view is ./CompareView.tsx.
 */

export interface DiffOptions {
  ignoreNiqqud?: boolean;
  ignoreWhitespace?: boolean;
}

export type Piece =
  | { type: "equal"; text: string; oldText?: string }
  | { type: "delete"; text: string }
  | { type: "insert"; text: string }
  /** One word: only its Hebrew prefix changed (`stem` is the same in both). */
  | { type: "prefix"; oldPrefix: string; newPrefix: string; stem: string; oldStem: string }
  /** One word: the same letters, other niqqud (shown only when niqqud is not ignored). */
  | { type: "niqqud"; oldText: string; text: string };

/** Niqqud and cantillation, without the maqaf (U+05BE), paseq (U+05C0), sof pasuq (U+05C3), nun hafukha (U+05C6). */
const MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;
const HEB_LETTER = /[א-ת]/;
const PREFIX_LETTERS = "ובהכלמש";

export function stripNiqqud(s: string): string {
  return s.replace(MARKS, "");
}

type Seg = { segment: string; isWordLike?: boolean };
type SegmenterLike = { segment(s: string): Iterable<Seg> };
let segmenter: SegmenterLike | null | undefined;

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  const I = Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => SegmenterLike };
  segmenter = I.Segmenter ? new I.Segmenter("he", { granularity: "word" }) : null;
  return segmenter;
}

/** Fallback tokenizer (no Intl.Segmenter): letters+marks+digits runs, whitespace runs, single other characters. */
const FALLBACK = /[\p{L}\p{M}\p{N}]+(?:['"׳״][\p{L}\p{M}]+)*|\s+|[^\s\p{L}\p{M}\p{N}]/gu;

/**
 * Tokens of `s`: words, whitespace runs and single punctuation marks; their
 * concatenation is `s`. A Hebrew word with a geresh or gershayim inside is
 * one token whatever the segmenter did with the mark.
 */
export function tokenize(s: string): string[] {
  const seg = getSegmenter();
  const raw: string[] = [];
  if (seg) {
    for (const x of seg.segment(s)) raw.push(x.segment);
  } else raw.push(...(s.match(FALLBACK) ?? []));
  // Join whitespace runs; split a whitespace segment that holds a newline from what follows.
  const out: string[] = [];
  for (const t of raw) {
    const last = out[out.length - 1];
    if (last !== undefined && /^\s+$/.test(t) && /^\s+$/.test(last)) out[out.length - 1] = last + t;
    else out.push(t);
  }
  // Geresh / gershayim (and ASCII ' ") between Hebrew letters: one word.
  const merged: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    const prev = merged[merged.length - 1];
    const next = out[i + 1];
    if (prev !== undefined && next !== undefined && /^['"׳״]$/.test(t) && HEB_LETTER.test(prev.slice(-2)) && HEB_LETTER.test(next[0] ?? "")) {
      merged[merged.length - 1] = prev + t + next;
      i++;
      continue;
    }
    // A word that already ends in a geresh mark ("ג'" + "ירפה"): join the rest of it.
    if (prev !== undefined && /[א-ת][֑-ׇ]*['׳״]$/.test(prev) && HEB_LETTER.test(t[0] ?? "")) {
      merged[merged.length - 1] = prev + t;
      continue;
    }
    merged.push(t);
  }
  return merged;
}

function keyOf(token: string, opts: DiffOptions): string {
  let k = token.normalize("NFC");
  if (opts.ignoreWhitespace && /^\s+$/.test(k)) return k.includes("\n\n") ? "\n\n" : k.includes("\n") ? "\n" : " ";
  if (opts.ignoreNiqqud) k = stripNiqqud(k);
  return k;
}

type Op = { type: "equal" | "delete" | "insert"; a: number; b: number; n: number };

/**
 * Myers' diff (O((N+M)·D)) of two key arrays: runs of equal / delete /
 * insert, in order, with `a`/`b` the start indices in each array. Common
 * head and tail are trimmed first; above `maxD` edits it gives up on the
 * middle and reports it as one deletion and one insertion.
 */
export function myers(A: readonly string[], B: readonly string[], maxD = 4000): Op[] {
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let eA = A.length;
  let eB = B.length;
  while (eA > s && eB > s && A[eA - 1] === B[eB - 1]) {
    eA--;
    eB--;
  }
  const ops: Op[] = [];
  const push = (type: Op["type"], a: number, b: number, n: number) => {
    if (n <= 0) return;
    const last = ops[ops.length - 1];
    if (last && last.type === type && last.a + (type === "insert" ? 0 : last.n) === a && last.b + (type === "delete" ? 0 : last.n) === b) last.n += n;
    else ops.push({ type, a, b, n });
  };
  push("equal", 0, 0, s);
  const N = eA - s;
  const M = eB - s;
  if (N === 0) push("insert", eA, s, M);
  else if (M === 0) push("delete", s, eB, N);
  else {
    const max = Math.min(N + M, maxD);
    const off = max + 1;
    const V = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    outer: for (let d = 0; d <= max; d++) {
      trace.push(V.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && A[s + x] === B[s + y]) {
          x++;
          y++;
        }
        V[off + k] = x;
        if (x >= N && y >= M) {
          found = d;
          break outer;
        }
      }
    }
    if (found < 0) {
      push("delete", s, s, N);
      push("insert", eA, s, M);
    } else {
      // Walk the trace back to collect the edit path.
      const path: Op[] = [];
      let x = N;
      let y = M;
      for (let d = found; d > 0; d--) {
        const v = trace[d];
        const k = x - y;
        const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
        const px = v[off + prevK];
        const py = px - prevK;
        const snake = Math.min(x - px - (prevK === k - 1 ? 1 : 0), y - py - (prevK === k + 1 ? 1 : 0));
        if (snake > 0) path.push({ type: "equal", a: s + x - snake, b: s + y - snake, n: snake });
        if (prevK === k - 1) path.push({ type: "delete", a: s + px, b: s + py, n: 1 });
        else path.push({ type: "insert", a: s + px, b: s + py, n: 1 });
        x = px;
        y = py;
      }
      if (x > 0) path.push({ type: "equal", a: s, b: s, n: x });
      for (let i = path.length - 1; i >= 0; i--) push(path[i].type, path[i].a, path[i].b, path[i].n);
    }
  }
  push("equal", eA, eB, A.length - eA);
  return ops;
}

/** Lines of `s`, each with its newline. */
function linesOf(s: string): string[] {
  return s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** A Hebrew word split into its prefix letters and the rest (at most 3 prefix letters, a stem of 2+ letters left). */
function prefixSplits(word: string): Array<{ prefix: string; stem: string }> {
  const out = [{ prefix: "", stem: word }];
  let i = 0;
  let letters = 0;
  while (i < word.length && letters < 3) {
    const ch = word[i];
    if (!PREFIX_LETTERS.includes(ch)) break;
    i++;
    while (i < word.length && /[֑-ׇ]/.test(word[i])) i++; // its niqqud
    letters++;
    const stem = word.slice(i);
    if ((stripNiqqud(stem).match(/[א-ת]/g) ?? []).length >= 2) out.push({ prefix: word.slice(0, i), stem });
  }
  return out;
}

const isHebrewWord = (t: string) => HEB_LETTER.test(t) && /^[א-ת֑-ׇ'"׳״]+$/.test(t);

/** A single-word replacement that is only a prefix change (same stem), else null. */
export function prefixChange(oldWord: string, newWord: string, opts: DiffOptions = {}): { oldPrefix: string; newPrefix: string; stem: string; oldStem: string } | null {
  if (!isHebrewWord(oldWord) || !isHebrewWord(newWord) || oldWord === newWord) return null;
  // Stems match by their letters: a prefix change often moves a dagesh or a vowel (הַבַּיִת → וּבַיִת);
  // the view marks such a stem as a niqqud change (`oldStem` ≠ `stem`).
  const norm = stripNiqqud;
  let best: { oldPrefix: string; newPrefix: string; stem: string; oldStem: string } | null = null;
  for (const a of prefixSplits(oldWord)) {
    for (const b of prefixSplits(newWord)) {
      if (norm(a.stem) !== norm(b.stem) || norm(a.prefix) === norm(b.prefix)) continue;
      // The longest shared stem: the smallest prefix change.
      if (!best || b.stem.length > best.stem.length) best = { oldPrefix: a.prefix, newPrefix: b.prefix, stem: b.stem, oldStem: a.stem };
    }
  }
  return best;
}

/**
 * Slide a lone deletion or insertion between two equal runs to where it
 * reads best: starting right after a line break, else right after a space
 * (git's "indent heuristic" in small). The tokens are the same either way.
 */
function slide(ops: Op[], ka: readonly string[], kb: readonly string[]): Op[] {
  for (let i = 1; i + 1 < ops.length; i++) {
    const [p, o, q] = [ops[i - 1], ops[i], ops[i + 1]];
    if (p.type !== "equal" || q.type !== "equal" || o.type === "equal") continue;
    const keys = o.type === "delete" ? ka : kb;
    const at = (op: Op) => (o.type === "delete" ? op.a : op.b);
    let start = at(o);
    const n = o.n;
    // How far it can move up (into p) and down (into q).
    let up = 0;
    while (up < p.n && keys[start - 1 - up] === keys[start + n - 1 - up]) up++;
    let down = 0;
    while (down < q.n && keys[start + down] === keys[start + n + down]) down++;
    if (!up && !down) continue;
    const score = (s: number) => {
      const before = keys[s - 1] ?? "\n";
      return before.endsWith("\n") ? 2 : /^\s+$/.test(before) ? 1 : 0;
    };
    let best = 0;
    let bestScore = score(start);
    for (let d = -up; d <= down; d++) {
      const sc = score(start + d);
      if (sc > bestScore) {
        best = d;
        bestScore = sc;
      }
    }
    if (!best) continue;
    p.n += best;
    o.a += best;
    o.b += best;
    q.a += best;
    q.b += best;
    q.n -= best;
    start += best;
  }
  return ops.filter((op) => op.n > 0);
}

/** Word diff of two token runs (already known to differ). */
function wordPieces(a: string[], b: string[], opts: DiffOptions, out: Piece[]): void {
  const ka = a.map((t) => keyOf(t, opts));
  const kb = b.map((t) => keyOf(t, opts));
  const ops = slide(myers(ka, kb), ka, kb);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === "equal") {
      const text = b.slice(op.b, op.b + op.n).join("");
      const oldText = a.slice(op.a, op.a + op.n).join("");
      // Equal under the options, yet niqqud differs: say so per word (when niqqud is not ignored this never happens).
      out.push(oldText === text ? { type: "equal", text } : { type: "equal", text, oldText });
      continue;
    }
    const next = ops[i + 1];
    if (op.type === "delete" && next?.type === "insert" && op.n === next.n) {
      // Pairwise: a word for a word. Prefix-only and niqqud-only changes are kept apart.
      for (let k = 0; k < op.n; k++) {
        const o = a[op.a + k];
        const n = b[next.b + k];
        const p = prefixChange(o, n, opts);
        if (!opts.ignoreNiqqud && stripNiqqud(o) === stripNiqqud(n) && HEB_LETTER.test(o)) out.push({ type: "niqqud", oldText: o, text: n });
        else if (p) out.push({ type: "prefix", ...p });
        else {
          out.push({ type: "delete", text: o });
          out.push({ type: "insert", text: n });
        }
      }
      i++;
      continue;
    }
    if (op.type === "delete") out.push({ type: "delete", text: a.slice(op.a, op.a + op.n).join("") });
    else out.push({ type: "insert", text: b.slice(op.b, op.b + op.n).join("") });
  }
}

/** Neighbouring pieces of a kind join; "-a +b ␣ -c +d" reads as "-a␣c +b␣d" (a lone space between two changes joins them). */
function tidy(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    if ((p.type === "equal" || p.type === "delete" || p.type === "insert") && !p.text) continue;
    const last = out[out.length - 1];
    if (last && last.type === p.type && (p.type === "delete" || p.type === "insert" || (p.type === "equal" && last.type === "equal" && !p.oldText && !last.oldText))) {
      (last as { text: string }).text += (p as { text: string }).text;
    } else out.push({ ...p });
  }
  // del ins (space) del ins → del(+space+del) ins(+space+ins)
  for (let k = 2; k + 2 < out.length; k++) {
    const mid = out[k];
    if (mid.type !== "equal" || mid.oldText || !/^[ \t ]+$/.test(mid.text)) continue;
    const [d1, i1, d2, i2] = [out[k - 2], out[k - 1], out[k + 1], out[k + 2]];
    if (d1.type === "delete" && i1.type === "insert" && d2.type === "delete" && i2.type === "insert") {
      d1.text += mid.text + d2.text;
      i1.text += mid.text + i2.text;
      out.splice(k, 3);
      k = Math.max(1, k - 2);
    }
  }
  return out;
}

/**
 * The word diff of `oldText` → `newText`: pieces in order. Equal pieces
 * carry the new text (and `oldText` when it differs only in what the
 * options ignore).
 */
export function wordDiff(oldText: string, newText: string, opts: DiffOptions = {}): Piece[] {
  if (oldText === newText) return oldText ? [{ type: "equal", text: newText }] : [];
  const out: Piece[] = [];
  const la = linesOf(oldText);
  const lb = linesOf(newText);
  // Line by line first, so a long note with a few edits stays linear; the changed runs go word by word.
  // A line's key without tokenizing it (a 2 MB note has 40k lines): what the options ignore, removed.
  const lineKey = (l: string) => {
    let k = l;
    if (opts.ignoreNiqqud) k = stripNiqqud(k);
    if (opts.ignoreWhitespace) k = k.replace(/[ \t\u00A0]+/g, " ").trim();
    return k;
  };
  const ops = la.length + lb.length > 400 ? myers(la.map(lineKey), lb.map(lineKey)) : [{ type: "delete" as const, a: 0, b: 0, n: la.length }, { type: "insert" as const, a: la.length, b: 0, n: lb.length }];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === "equal") {
      const ta = la.slice(op.a, op.a + op.n);
      const tb = lb.slice(op.b, op.b + op.n);
      for (let k = 0; k < op.n; k++) {
        if (ta[k] === tb[k]) out.push({ type: "equal", text: tb[k] });
        else wordPieces(tokenize(ta[k]), tokenize(tb[k]), opts, out);
      }
      continue;
    }
    // A run of changed lines: the deleted and the inserted lines, word by word.
    const del = op.type === "delete" ? op : null;
    const ins = op.type === "insert" ? op : ops[i + 1]?.type === "insert" ? ops[i + 1] : null;
    if (del && ins && ins !== op) i++;
    const a = del ? la.slice(del.a, del.a + del.n).join("") : "";
    const b = ins ? lb.slice(ins.b, ins.b + ins.n).join("") : "";
    wordPieces(tokenize(a), tokenize(b), opts, out);
  }
  return tidy(out);
}

/** Changes: maximal runs of non-equal pieces (a deletion next to its insertion is one change). */
export function changeRuns(pieces: readonly Piece[]): Array<{ from: number; to: number }> {
  const runs: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].type === "equal") continue;
    const from = i;
    while (i + 1 < pieces.length && pieces[i + 1].type !== "equal") i++;
    runs.push({ from, to: i });
  }
  return runs;
}

/** A compact text form of a diff, for tests and screen readers: [-deleted-]{+inserted+}, prefix change [-ו-]{+ה+}stem, niqqud {~old→new~}. */
export function notation(pieces: readonly Piece[]): string {
  return pieces
    .map((p) => {
      switch (p.type) {
        case "equal":
          return p.text;
        case "delete":
          return `[-${p.text}-]`;
        case "insert":
          return `{+${p.text}+}`;
        case "prefix":
          return `${p.oldPrefix ? `[-${p.oldPrefix}-]` : ""}${p.newPrefix ? `{+${p.newPrefix}+}` : ""}${p.oldStem !== p.stem ? `{~${p.oldStem}→${p.stem}~}` : p.stem}`;
        case "niqqud":
          return `{~${p.oldText}→${p.text}~}`;
      }
    })
    .join("");
}

/**
 * The two sides of a diff as rows for the two-column view: each row is one
 * paragraph (text up to a blank line) of the old and of the new text, with
 * the pieces that fall in it. Rows line up: a paragraph added on one side
 * has an empty cell on the other.
 */
/** A piece in a row, with the change it belongs to (−1: unchanged), for navigation. */
export type RowPiece = Piece & { ch: number };

export interface Row {
  old: RowPiece[];
  new: RowPiece[];
}

const PARA_END = /\n[ \t]*\n$/;
const splitParas = (text: string) => text.split(/(?<=\n[ \t]*\n)/).filter((x) => x !== "");

export function rows(pieces: readonly Piece[]): Row[] {
  const change = new Int32Array(pieces.length).fill(-1);
  changeRuns(pieces).forEach((r, i) => {
    for (let k = r.from; k <= r.to; k++) change[k] = i;
  });
  const out: Row[] = [];
  let row: Row = { old: [], new: [] };
  let ended = { old: false, new: false };
  const close = () => {
    if (row.old.length || row.new.length) out.push(row);
    row = { old: [], new: [] };
    ended = { old: false, new: false };
  };
  /** Close the row once each side is either finished (its paragraph ended) or has nothing. */
  const maybeClose = (next: Piece | undefined) => {
    const oldDone = ended.old || !row.old.length;
    const newDone = ended.new || !row.new.length;
    if (!(ended.old || ended.new) || !oldDone || !newDone) return;
    // A deleted paragraph right before an inserted one: the replacement shares the row.
    if (ended.old && !row.new.length && next?.type === "insert") return;
    close();
  };
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const ch = change[i];
    const next = pieces[i + 1];
    if (p.type === "equal") {
      const parts = splitParas(p.text);
      const oldParts = p.oldText !== undefined ? splitParas(p.oldText) : null;
      parts.forEach((part, k) => {
        // Each side keeps its own text when they are equal only under the options.
        const old = oldParts ? (oldParts.length === parts.length ? oldParts[k] : k === 0 ? p.oldText! : "") : part;
        // An equal run ends what is open on either side first.
        if (ended.old || ended.new) close();
        row.old.push({ type: "equal", text: old, ch });
        row.new.push({ type: "equal", text: part, ch });
        if (PARA_END.test(part)) {
          ended = { old: true, new: true };
          close();
        }
      });
    } else if (p.type === "delete" || p.type === "insert") {
      const side = p.type === "delete" ? "old" : "new";
      for (const part of splitParas(p.text)) {
        if (ended[side]) close();
        row[side].push({ type: p.type, text: part, ch });
        if (PARA_END.test(part)) {
          ended[side] = true;
          maybeClose(next);
        }
      }
    } else {
      if (ended.old || ended.new) close();
      row.old.push({ ...p, ch });
      row.new.push({ ...p, ch });
    }
  }
  close();
  return out;
}
