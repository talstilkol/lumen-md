/**
 * Suggesting mode (track changes) — pure logic.
 *
 * Suggestions are stored in the document itself as CriticMarkup so the file
 * stays plain markdown that any editor can read:
 *
 *   {++inserted++}   {--deleted--}   {~~old~>new~~}   {>>comment<<}   {==highlight==}
 *
 * This module is DOM- and CodeMirror-free: it parses CriticMarkup, resolves
 * (accepts / rejects) it, and rewrites a single user edit into the
 * CriticMarkup-preserving edit that suggesting mode applies instead. The
 * CodeMirror wiring (transaction filter, decorations, commands) lives in
 * `./suggestingExtension.ts`.
 */

export type SuggestionKind = "insert" | "delete" | "substitute" | "comment" | "highlight";

export interface Suggestion {
  kind: SuggestionKind;
  /** Start of the whole markup (the `{`). */
  from: number;
  /** End of the whole markup (just after the `}`). */
  to: number;
  /** Content range. For `substitute` this is the *old* text. */
  contentFrom: number;
  contentTo: number;
  /** `substitute` only — range of the *new* text. */
  newFrom?: number;
  newTo?: number;
}

export interface TextRange {
  from: number;
  to: number;
  /** "fence" = fenced code block, "inline" = backtick code span. */
  type: "fence" | "inline";
}

/* ─── Code ranges (CriticMarkup is literal inside code) ──────────────── */

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Fenced code blocks and inline code spans. CriticMarkup inside them is
 * literal text — it is neither parsed nor produced there.
 *
 * Fence ranges run from the start of the opening fence line to the end of
 * the closing fence line (exclusive of its newline); an unclosed fence runs
 * to the end of the document, as in CommonMark.
 */
export function findCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const fences: TextRange[] = [];
  let pos = 0;
  let open: { char: string; len: number; from: number } | null = null;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end);
    if (open) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1][0] === open.char && m[1].length >= open.len) {
        fences.push({ from: open.from, to: end, type: "fence" });
        open = null;
      }
    } else {
      const m = FENCE_OPEN_RE.exec(line);
      // A backtick fence's info string may not contain backticks.
      if (m && !(m[1][0] === "`" && line.slice(m[0].length).includes("`"))) {
        open = { char: m[1][0], len: m[1].length, from: pos };
      }
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (open) fences.push({ from: open.from, to: text.length, type: "fence" });

  // Inline code spans in the gaps between fences.
  let gapStart = 0;
  for (const f of [...fences, { from: text.length, to: text.length, type: "fence" as const }]) {
    collectInlineCode(text, gapStart, f.from, ranges);
    if (f.from < f.to || f.from < text.length) ranges.push(f);
    gapStart = f.to;
  }
  return ranges
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from);
}

function collectInlineCode(text: string, from: number, to: number, out: TextRange[]) {
  let i = from;
  while (i < to) {
    const tick = text.indexOf("`", i);
    if (tick === -1 || tick >= to) return;
    // Backslash-escaped backtick is literal.
    if (tick > 0 && text[tick - 1] === "\\") {
      i = tick + 1;
      continue;
    }
    let runEnd = tick;
    while (runEnd < to && text[runEnd] === "`") runEnd++;
    const run = runEnd - tick;
    // Find a closing run of exactly the same length, not crossing a blank line.
    let j = runEnd;
    let closed = -1;
    while (j < to) {
      const next = text.indexOf("`", j);
      if (next === -1 || next >= to) break;
      const between = text.slice(runEnd, next);
      if (/\n[ \t]*\n/.test(between)) break;
      let e = next;
      while (e < to && text[e] === "`") e++;
      if (e - next === run) {
        closed = e;
        break;
      }
      j = e;
    }
    if (closed === -1) {
      i = runEnd;
      continue;
    }
    out.push({ from: tick, to: closed, type: "inline" });
    i = closed;
  }
}

/* ─── Parsing ─────────────────────────────────────────────────────────── */

const CRITIC_RE =
  /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{>>([\s\S]*?)<<\}|\{==([\s\S]*?)==\}/g;

/** Quick pre-check so documents without CriticMarkup skip the full parse. */
export function mayContainCriticMarkup(text: string): boolean {
  return /\{(\+\+|--|~~|>>|==)/.test(text);
}

/**
 * Parse every CriticMarkup span in `text`, in document order. Markup that
 * starts inside a code span, or overlaps a fenced code block, is ignored.
 */
export function parseSuggestions(text: string, code: TextRange[] = findCodeRanges(text)): Suggestion[] {
  const out: Suggestion[] = [];
  if (!mayContainCriticMarkup(text)) return out;
  CRITIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CRITIC_RE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    const inCode = code.find((c) =>
      c.type === "inline" ? from >= c.from && from < c.to : from < c.to && to > c.from,
    );
    if (inCode) {
      // Resume scanning after the code range (or after this `{` when the
      // markup merely overlaps a later fence).
      CRITIC_RE.lastIndex = Math.max(from + 1, inCode.type === "inline" ? inCode.to : from + 1);
      continue;
    }
    if (m[1] !== undefined) {
      out.push({ kind: "insert", from, to, contentFrom: from + 3, contentTo: to - 3 });
    } else if (m[2] !== undefined) {
      out.push({ kind: "delete", from, to, contentFrom: from + 3, contentTo: to - 3 });
    } else if (m[3] !== undefined) {
      const contentFrom = from + 3;
      const contentTo = contentFrom + m[3].length;
      out.push({
        kind: "substitute",
        from,
        to,
        contentFrom,
        contentTo,
        newFrom: contentTo + 2,
        newTo: to - 3,
      });
    } else if (m[5] !== undefined) {
      out.push({ kind: "comment", from, to, contentFrom: from + 3, contentTo: to - 3 });
    } else {
      out.push({ kind: "highlight", from, to, contentFrom: from + 3, contentTo: to - 3 });
    }
  }
  return out;
}

/* ─── Accept / reject ─────────────────────────────────────────────────── */

export type Resolution = "accept" | "reject";

/** The text a suggestion collapses to once accepted or rejected. */
export function resolvedText(text: string, s: Suggestion, mode: Resolution): string {
  const content = text.slice(s.contentFrom, s.contentTo);
  switch (s.kind) {
    case "insert":
      return mode === "accept" ? content : "";
    case "delete":
      return mode === "accept" ? "" : content;
    case "substitute":
      return mode === "accept" ? text.slice(s.newFrom, s.newTo) : content;
    case "comment":
      return "";
    case "highlight":
      return content;
  }
}

export interface PlainChange {
  from: number;
  to: number;
  insert: string;
}

/** Changes (in document order) that accept / reject the given suggestions. */
export function resolutionChanges(
  text: string,
  suggestions: readonly Suggestion[],
  mode: Resolution,
): PlainChange[] {
  return suggestions.map((s) => ({ from: s.from, to: s.to, insert: resolvedText(text, s, mode) }));
}

/** Accept or reject every suggestion in `text`. */
export function resolveAll(text: string, mode: Resolution): string {
  const changes = resolutionChanges(text, parseSuggestions(text), mode);
  let out = text;
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

/** The suggestion under `pos` (boundaries inclusive), or null. */
export function suggestionAt(suggestions: readonly Suggestion[], pos: number): Suggestion | null {
  // Prefer a span that starts at / contains pos over one that merely ends there.
  return (
    suggestions.find((s) => s.from <= pos && pos < s.to) ??
    suggestions.find((s) => s.to === pos) ??
    null
  );
}

/** First suggestion starting after `pos`, wrapping to the first one. */
export function nextSuggestion(suggestions: readonly Suggestion[], pos: number): Suggestion | null {
  if (suggestions.length === 0) return null;
  return suggestions.find((s) => s.from > pos) ?? suggestions[0];
}

/** Last suggestion starting before `pos`, wrapping to the last one. */
export function prevSuggestion(suggestions: readonly Suggestion[], pos: number): Suggestion | null {
  if (suggestions.length === 0) return null;
  for (let i = suggestions.length - 1; i >= 0; i--) {
    if (suggestions[i].from < pos) return suggestions[i];
  }
  return suggestions[suggestions.length - 1];
}

/* ─── Edit transformation ─────────────────────────────────────────────── */

/**
 * How the user produced the edit:
 *  - "insert":    typing / paste with an empty selection
 *  - "replace":   typing / paste over a selection
 *  - "backward":  Backspace-like deletion (cursor ends at the start)
 *  - "forward":   Delete-like deletion (cursor ends after the deletion)
 *  - "selection": deleting a selection (cut, delete.selection, …)
 */
export type EditKind = "insert" | "replace" | "backward" | "forward" | "selection";

export interface SuggestEdit {
  from: number;
  to: number;
  insert: string;
  kind: EditKind;
}

export interface SuggestResult {
  /** The change to apply instead (start-document coordinates), or null for a no-op. */
  change: PlainChange | null;
  /** Cursor position in the *new* document. */
  cursor: number;
  /**
   * Set when the edit can't be recorded unambiguously — the text itself
   * contains CriticMarkup delimiters (e.g. pasting `a++}b`), so wrapping it
   * would change what accept/reject produce. The edit is dropped (`change`
   * is null) and the UI tells the user.
   */
  untrackable?: true;
}

type Seg =
  | { t: "text" | "raw"; text: string }
  | { t: "del" | "ins"; text: string; fresh: boolean }
  | { t: "mark" };

/** Classify a CodeMirror user event + change into an `EditKind`. */
export function editKindFor(userEvent: string, from: number, to: number, insert: string): EditKind | null {
  if (insert.length > 0) return from === to ? "insert" : "replace";
  if (from === to) return null;
  if (userEvent.startsWith("delete.backward")) return "backward";
  if (userEvent.startsWith("delete.forward")) return "forward";
  return "selection";
}

function isInsideCode(code: readonly TextRange[], from: number, to: number): boolean {
  return code.some((c) =>
    c.type === "fence" ? c.from <= from && to <= c.to : c.from < from && to < c.to,
  );
}

/** Whether [from, to) lies purely inside editable content (own insertion / substitution's new text). */
function insideOwnText(s: Suggestion, from: number, to: number): boolean {
  if (s.kind === "insert") return from >= s.contentFrom && to <= s.contentTo;
  if (s.kind === "substitute") return from >= s.newFrom! && to <= s.newTo!;
  return false;
}

function charLenBefore(text: string, pos: number): number {
  const c = text.charCodeAt(pos - 1);
  return pos >= 2 && c >= 0xdc00 && c <= 0xdfff ? 2 : 1;
}

function charLenAt(text: string, pos: number): number {
  const c = text.charCodeAt(pos);
  return pos + 1 < text.length && c >= 0xd800 && c <= 0xdbff ? 2 : 1;
}

/**
 * Backspace / Delete next to (or inside) markup delimiters: retarget the
 * deletion to the logical character the user means, skipping delimiters and
 * text that is already deleted. Returns null when there is nothing to delete.
 */
function retarget(
  text: string,
  sugg: readonly Suggestion[],
  edit: SuggestEdit,
): { from: number; to: number } | null {
  if (edit.kind === "backward") {
    let pos = edit.to;
    for (let guard = 0; guard < 10_000; guard++) {
      const s = sugg.find((x) => x.from < pos && pos <= x.to);
      if (!s) {
        if (pos <= 0) return null;
        return { from: pos - charLenBefore(text, pos), to: pos };
      }
      const [cf, ct] =
        s.kind === "insert" ? [s.contentFrom, s.contentTo] :
        s.kind === "substitute" ? [s.newFrom!, s.newTo!] : [-1, -1];
      if (cf >= 0 && pos > cf) {
        const p = Math.min(pos, ct);
        if (p > cf) return { from: p - charLenBefore(text, p), to: p };
      }
      pos = s.from;
    }
    return null;
  }
  // forward
  let pos = edit.from;
  for (let guard = 0; guard < 10_000; guard++) {
    const s = sugg.find((x) => x.from <= pos && pos < x.to);
    if (!s) {
      if (pos >= text.length) return null;
      return { from: pos, to: pos + charLenAt(text, pos) };
    }
    const [cf, ct] =
      s.kind === "insert" ? [s.contentFrom, s.contentTo] :
      s.kind === "substitute" ? [s.newFrom!, s.newTo!] : [-1, -1];
    if (cf >= 0 && pos < ct) {
      const p = Math.max(pos, cf);
      if (p < ct) return { from: p, to: p + charLenAt(text, p) };
    }
    pos = s.to;
  }
  return null;
}

/**
 * Rewrite one user edit so it is recorded as a suggestion.
 *
 * Returns null when the edit should pass through untouched (it lies entirely
 * inside a code block / code span, where CriticMarkup would be literal).
 *
 * CriticMarkup has no escape syntax, so text containing a closing delimiter
 * (`++}`, `--}`, `~>`, `~~}`) can't always be wrapped safely. Every result
 * is therefore verified: a tracked edit must leave the "reject all" view
 * unchanged (that view is the original document), and an insertion must
 * grow the "accept all" view by exactly the inserted text. A result that
 * breaks either is refused with `untrackable` instead of corrupting the
 * document.
 */
export function transformEdit(text: string, edit: SuggestEdit): SuggestResult | null {
  const res = transformEditUnchecked(text, edit);
  if (!res || !res.change) return res;
  const next = applyChange(text, res.change);
  const accepted = resolveAll(next, "accept");
  // "Accept all" must be final: typed text that itself looks like
  // CriticMarkup (e.g. replacing a selection with `{++x++}`) would otherwise
  // surface as a NEW suggestion once accepted, and a second accept would
  // change the literal text the user typed.
  const ok =
    resolveAll(next, "reject") === resolveAll(text, "reject") &&
    (resolveAll(accepted, "accept") === accepted || !isFixedPointAccept(text)) &&
    (edit.kind !== "insert" ||
      accepted.length === resolveAll(text, "accept").length + edit.insert.length);
  if (ok) return res;
  return { change: null, cursor: edit.kind === "backward" ? edit.to : edit.from, untrackable: true };
}

/** True when accepting all suggestions leaves no further suggestions behind. */
function isFixedPointAccept(text: string): boolean {
  const acc = resolveAll(text, "accept");
  return resolveAll(acc, "accept") === acc;
}

function transformEditUnchecked(text: string, edit: SuggestEdit): SuggestResult | null {
  const code = findCodeRanges(text);
  const sugg = parseSuggestions(text, code);
  let { from, to } = edit;
  const insert = edit.insert;

  const touching = sugg.filter((s) => s.from <= to && s.to >= from);
  if (touching.length === 0 && isInsideCode(code, from, to)) return null;

  /* Pure insertion. */
  if (edit.kind === "insert") {
    let p = from;
    for (let guard = 0; guard < 100; guard++) {
      const inside = sugg.find((s) => s.from < p && p < s.to);
      if (!inside) break;
      if (insideOwnText(inside, p, p)) {
        return { change: { from: p, to: p, insert }, cursor: p + insert.length };
      }
      p = inside.to; // inside a deletion / comment / delimiter → after it
    }
    const before = sugg.find((s) => s.to === p && (s.kind === "insert" || s.kind === "substitute"));
    if (before) {
      const at = before.kind === "insert" ? before.contentTo : before.newTo!;
      return { change: { from: at, to: at, insert }, cursor: at + insert.length };
    }
    const after = sugg.find((s) => s.from === p && s.kind === "insert");
    if (after) {
      return {
        change: { from: after.contentFrom, to: after.contentFrom, insert },
        cursor: after.contentFrom + insert.length,
      };
    }
    return { change: { from: p, to: p, insert: `{++${insert}++}` }, cursor: p + 3 + insert.length };
  }

  /* Backspace / Delete: skip delimiters and already-deleted text. */
  if (edit.kind === "backward" || edit.kind === "forward") {
    const overlapsMarkup = sugg.some(
      (s) => s.from < to && s.to > from && !insideOwnText(s, from, to),
    );
    if (overlapsMarkup) {
      const r = retarget(text, sugg, edit);
      if (!r) return { change: null, cursor: edit.kind === "backward" ? edit.from : edit.to };
      from = r.from;
      to = r.to;
    }
  }

  /* Plain replacement outside any markup → a substitution. */
  if (edit.kind === "replace" && !sugg.some((s) => s.from <= to && s.to >= from)) {
    const old = text.slice(from, to);
    return {
      change: { from, to, insert: `{~~${old}~>${insert}~~}` },
      cursor: from + 3 + old.length + 2 + insert.length,
    };
  }

  /* General case: rebuild the affected span. */
  let spanFrom = from;
  let spanTo = to;
  const involved = sugg.filter(
    (s) =>
      (s.from < to && s.to > from) ||
      ((s.to === from || s.from === to) && s.kind !== "comment" && s.kind !== "highlight"),
  );
  for (const s of involved) {
    spanFrom = Math.min(spanFrom, s.from);
    spanTo = Math.max(spanTo, s.to);
  }

  const segs: Seg[] = [];
  const pending: Array<{ pos: number; seg: Seg; done: boolean }> = [];
  if (insert) pending.push({ pos: to, seg: { t: "ins", text: insert, fresh: true }, done: false });
  pending.push({ pos: edit.kind === "backward" ? from : to, seg: { t: "mark" }, done: false });

  const placeAt = (x: number) => {
    for (const p of pending) {
      if (!p.done && p.pos <= x) {
        segs.push(p.seg);
        p.done = true;
      }
    }
  };
  const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
  /** Split [a, b) at the edit range: inside → `inside`, outside → `outside`. */
  const emitInterval = (a: number, b: number, outside: "text" | "ins", inside: "del" | "drop") => {
    const cuts = [...new Set([a, b, clamp(from, a, b), clamp(to, a, b)])].sort((x, y) => x - y);
    for (let i = 0; i < cuts.length - 1; i++) {
      const x = cuts[i];
      const y = cuts[i + 1];
      placeAt(x);
      const slice = text.slice(x, y);
      if (x >= from && y <= to) {
        if (inside === "del") segs.push({ t: "del", text: slice, fresh: true });
      } else if (outside === "ins") {
        segs.push({ t: "ins", text: slice, fresh: false });
      } else {
        segs.push({ t: "text", text: slice });
      }
    }
    placeAt(b);
  };

  let q = spanFrom;
  for (const s of involved) {
    if (s.from > q) emitInterval(q, s.from, "text", "del");
    placeAt(s.from);
    switch (s.kind) {
      case "insert":
        emitInterval(s.contentFrom, s.contentTo, "ins", "drop");
        break;
      case "delete":
        segs.push({ t: "del", text: text.slice(s.contentFrom, s.contentTo), fresh: false });
        break;
      case "substitute":
        segs.push({ t: "del", text: text.slice(s.contentFrom, s.contentTo), fresh: false });
        emitInterval(s.newFrom!, s.newTo!, "ins", "drop");
        break;
      default:
        segs.push({ t: "raw", text: text.slice(s.from, s.to) });
    }
    placeAt(s.to);
    q = s.to;
  }
  if (q < spanTo) emitInterval(q, spanTo, "text", "del");
  placeAt(Number.POSITIVE_INFINITY);

  const ser = serialize(segs);
  const cursorInSpan =
    edit.kind === "replace"
      ? ser.freshInsEnd ?? ser.markPos
      : edit.kind === "backward"
        ? ser.firstFreshDelStart ?? ser.markPos
        : ser.lastFreshDelEnd ?? ser.markPos;

  const oldSpan = text.slice(spanFrom, spanTo);
  const change = minimalChange(oldSpan, ser.out, spanFrom);
  return { change, cursor: spanFrom + cursorInSpan };
}

interface Serialized {
  out: string;
  markPos: number;
  freshInsEnd?: number;
  firstFreshDelStart?: number;
  lastFreshDelEnd?: number;
}

/**
 * Turn segments into CriticMarkup, merging adjacent deletions / insertions
 * and folding a deletion directly followed by an insertion into
 * `{~~old~>new~~}`.
 */
function serialize(segs: Seg[]): Serialized {
  let out = "";
  let markPos = 0;
  let freshInsEnd: number | undefined;
  let firstFreshDelStart: number | undefined;
  let lastFreshDelEnd: number | undefined;

  /** Collect a run of `type` segments starting at i (marks inside a run stay in it). */
  const collect = (i: number, type: "del" | "ins"): number => {
    let j = i;
    while (j < segs.length) {
      const s = segs[j];
      if (s.t === type) {
        j++;
        continue;
      }
      if (s.t === "mark") {
        // A mark belongs to the run only if the run continues after it.
        let k = j + 1;
        while (k < segs.length && segs[k].t === "mark") k++;
        // Trailing marks stay inside an insertion so the cursor lands
        // before its closing `++}` and keeps typing into it.
        if ((k < segs.length && segs[k].t === type) || (type === "ins" && j > i)) {
          j = k;
          continue;
        }
      }
      break;
    }
    return j;
  };
  const textOf = (a: number, b: number) =>
    segs.slice(a, b).reduce((acc, s) => acc + (s.t === "mark" ? "" : s.text), "");

  let i = 0;
  while (i < segs.length) {
    const s = segs[i];
    if (s.t === "mark") {
      markPos = out.length;
      i++;
      continue;
    }
    if (s.t === "text" || s.t === "raw") {
      out += s.text;
      i++;
      continue;
    }
    let delEnd = i;
    if (s.t === "del") delEnd = collect(i, "del");
    let insStart = delEnd;
    // Only fold into a substitution when the insertion follows immediately.
    const insEnd = insStart < segs.length && segs[insStart].t === "ins" ? collect(insStart, "ins") : insStart;
    if (s.t === "ins") insStart = i;
    const delText = s.t === "del" ? textOf(i, delEnd) : "";
    const insText = textOf(insStart, insEnd);
    const runStart = out.length;
    let hasFreshDel = false;

    const emitBody = (a: number, b: number) => {
      for (let k = a; k < b; k++) {
        const g = segs[k];
        if (g.t === "mark") {
          markPos = out.length;
          continue;
        }
        if (g.t === "text" || g.t === "raw") continue;
        out += g.text;
        if (g.t === "del" && g.fresh && g.text) hasFreshDel = true;
        if (g.t === "ins" && g.fresh) freshInsEnd = out.length;
      }
    };

    if (delText && insText) {
      out += "{~~";
      emitBody(i, delEnd);
      out += "~>";
      emitBody(insStart, insEnd);
      out += "~~}";
    } else if (delText) {
      out += "{--";
      emitBody(i, delEnd);
      out += "--}";
      // A trailing empty insertion run still carries marks.
      if (insEnd > insStart) {
        const before = out.length;
        emitBody(insStart, insEnd);
        out = out.slice(0, before);
      }
    } else if (insText) {
      // An empty deletion run before it only carries marks.
      if (s.t === "del") emitBody(i, delEnd);
      out += "{++";
      emitBody(insStart, insEnd);
      out += "++}";
    } else {
      // Everything in this run was removed — keep the marks' position.
      const end = Math.max(delEnd, insEnd);
      for (let k = i; k < end; k++) if (segs[k].t === "mark") markPos = out.length;
      i = end;
      continue;
    }
    if (hasFreshDel) {
      if (firstFreshDelStart === undefined) firstFreshDelStart = runStart;
      lastFreshDelEnd = out.length;
    }
    i = Math.max(delEnd, insEnd);
  }
  return { out, markPos, freshInsEnd, firstFreshDelStart, lastFreshDelEnd };
}

/** Smallest single change turning `a` into `b`, offset by `base`. */
function minimalChange(a: string, b: string, base: number): PlainChange | null {
  if (a === b) return null;
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < max - p &&
    a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)
  ) s++;
  return { from: base + p, to: base + a.length - s, insert: b.slice(p, b.length - s) };
}

/** Apply a plain change to a string (test / helper convenience). */
export function applyChange(text: string, change: PlainChange | null): string {
  if (!change) return text;
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}
