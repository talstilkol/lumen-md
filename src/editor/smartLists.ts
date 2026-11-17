/**
 * Smart lists (plan W13.E2): the list behaviours Obsidian polished in
 * 1.14.0 and 1.15.1, as pure operations on Markdown text, so both editors
 * share one definition and one golden suite (tests/fixtures/smart-lists).
 *
 * Every operation takes the text and a selection and returns the new text
 * and selection — or `null` when it does not apply (the editor's own key
 * handling runs then). The CodeMirror binding is `smartListKeymap()` in
 * smartListsExtension.ts.
 *
 *   enter       continue the item (bullet, number +1, Hebrew letter +1,
 *               task unchecked, inside a blockquote); split at the caret;
 *               an empty item outdents, or ends the list at the top level;
 *               at the start of an item's text, a new item goes above
 *   shiftEnter  a line break inside the item, aligned to its text
 *   tab         indent the item (with its children) under the item above —
 *               never deeper than one level (1.15.1 "over-indent"); a first
 *               item stays; numbers restart / continue in the new sublist
 *   shiftTab    outdent (with children), renumbering both levels
 *   moveUp/Down swap the item, with its nested items, with its sibling
 *               (1.15.1 "moving nested items")
 *   backspace   at the start of an item's text: the marker goes
 *   toggleTask  none → [ ] → [x] → none, on every selected item
 *   toggleBold  partial selections (1.14): inside bold → that part unbolds;
 *               across a bold edge → the union is bold; empty → the word
 *   paste       a list pasted into an item: no doubled marker, the pasted
 *               levels re-based on the item's level (1.14 "smarter paste")
 *
 * Hebrew: numbered lists in Hebrew letters (א. ב. … ט. י. יא. … טו. טז.)
 * continue and renumber like digits (W13.H5); everything else works on
 * Hebrew and mixed lines unchanged, since it only reads the line's start.
 */

export interface Sel {
  anchor: number;
  head: number;
}
export interface ListState {
  doc: string;
  sel: Sel;
}

/* ─── Hebrew numerals (plain letters, no geresh: a list marker) ─────── */

const HEB_VALUES: Array<[number, string]> = [
  [400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"],
  [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"],
];
const HEB_OF = new Map(HEB_VALUES.map(([v, l]) => [l, v]));

export function hebrewNumeral(n: number): string {
  let s = "";
  let rest = Math.max(1, Math.min(999, Math.floor(n)));
  while (rest > 0) {
    if (rest % 100 === 15 || rest % 100 === 16) {
      // Hundreds first, then טו / טז (never יה / יו).
      if (rest >= 100) {
        const [v, l] = HEB_VALUES.find(([v]) => v <= rest - (rest % 100))!;
        s += l;
        rest -= v;
        continue;
      }
      s += rest === 15 ? "טו" : "טז";
      break;
    }
    const [v, l] = HEB_VALUES.find(([v]) => v <= rest)!;
    s += l;
    rest -= v;
  }
  return s;
}

/** The value of a Hebrew numeral written as a list marker, or null when the letters are not one (e.g. a word). */
export function parseHebrewNumeral(s: string): number | null {
  if (!s || s.length > 5) return null;
  let n = 0;
  for (const ch of s) {
    const v = HEB_OF.get(ch);
    if (v === undefined) return null;
    n += v;
  }
  return hebrewNumeral(n) === s ? n : null;
}

/* ─── Parsing a line ────────────────────────────────────────────────── */

export interface Item {
  /** `> ` prefixes (blockquote), kept as written. */
  quote: string;
  /** Leading whitespace after the quote. */
  indent: string;
  /** `-`, `*`, `+`, `3.`, `3)`, `ב.` … */
  marker: string;
  kind: "bullet" | "number" | "hebrew";
  /** For numbered markers: the number; the delimiter. */
  num: number;
  delim: "." | ")" | "";
  /** Spaces after the marker (at least one, or none when the line is just the marker). */
  gap: string;
  /** `[ ] ` / `[x] ` with its trailing space, or "". */
  task: string;
  /** Column where the item's text starts (after quote, indent, marker, gap, task). */
  textStart: number;
  text: string;
}

const LINE = /^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*)([-*+]|\d{1,9}[.)]|[א-ת]{1,5}[.)])([ \t]+|$)(\[[ xX]\][ \t]+|\[[ xX]\]$)?/;

export function parseItem(line: string): Item | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const [, quote, indent, marker, gap, task = ""] = m;
  let kind: Item["kind"] = "bullet";
  let num = 0;
  let delim: Item["delim"] = "";
  if (/^\d/.test(marker)) {
    kind = "number";
    num = Number(marker.slice(0, -1));
    delim = marker.slice(-1) as "." | ")";
  } else if (/^[א-ת]/.test(marker)) {
    const v = parseHebrewNumeral(marker.slice(0, -1));
    if (v === null) return null;
    kind = "hebrew";
    num = v;
    delim = marker.slice(-1) as "." | ")";
  }
  // A thematic break ("- - -", "***") is not an item.
  if (kind === "bullet" && /^[ \t]*([-*+])([ \t]*\1){2,}[ \t]*$/.test(line.slice(quote.length))) return null;
  const textStart = quote.length + indent.length + marker.length + gap.length + task.length;
  return { quote, indent, marker, kind, num, delim, gap, task, textStart, text: line.slice(textStart) };
}

/** Indent width in columns (a tab is 4). */
const width = (ws: string) => [...ws].reduce((n, c) => n + (c === "\t" ? 4 - (n % 4) : 1), 0);
const spaces = (n: number) => " ".repeat(Math.max(0, n));
const levelOf = (it: Item) => width(it.indent);
/** Column where the item's content begins, relative to the quote: what a child indents to. */
const contentCol = (it: Item) => width(it.indent) + it.marker.length + Math.max(1, it.gap.length);

function markerFor(kind: Item["kind"], n: number, delim: string, bullet: string): string {
  if (kind === "number") return `${n}${delim}`;
  if (kind === "hebrew") return `${hebrewNumeral(n)}${delim}`;
  return bullet;
}

/* ─── Text ⇄ lines ──────────────────────────────────────────────────── */

interface Lines {
  lines: string[];
  /** Selection as (line, column). */
  a: [number, number];
  h: [number, number];
}

function toLines(s: ListState): Lines {
  const lines = s.doc.split("\n");
  const pos = (off: number): [number, number] => {
    let o = 0;
    for (let i = 0; i < lines.length; i++) {
      if (off <= o + lines[i].length) return [i, off - o];
      o += lines[i].length + 1;
    }
    return [lines.length - 1, lines[lines.length - 1].length];
  };
  return { lines, a: pos(s.sel.anchor), h: pos(s.sel.head) };
}

function fromLines(lines: string[], a: [number, number], h: [number, number] = a): ListState {
  const off = ([l, c]: [number, number]) => {
    let o = 0;
    for (let i = 0; i < l; i++) o += lines[i].length + 1;
    return o + Math.min(c, lines[l]?.length ?? 0);
  };
  return { doc: lines.join("\n"), sel: { anchor: off(a), head: off(h) } };
}

/** The last line of an item's block: the item and every following line that is blank-then-deeper or deeper. */
function blockEnd(lines: string[], i: number): number {
  const it = parseItem(lines[i])!;
  const lvl = levelOf(it);
  let end = i;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.slice(it.quote.length).trim()) {
      // A blank line belongs to the block only when a deeper line follows.
      let k = j + 1;
      while (k < lines.length && !lines[k].slice(it.quote.length).trim()) k++;
      if (k < lines.length && width(/^[ \t]*/.exec(lines[k].slice(it.quote.length))![0]) > lvl && lines[k].startsWith(it.quote)) {
        j = k - 1;
        continue;
      }
      break;
    }
    if (!l.startsWith(it.quote)) break;
    const ind = width(/^[ \t]*/.exec(l.slice(it.quote.length))![0]);
    if (ind <= lvl) break;
    end = j;
  }
  return end;
}

/** The previous sibling item (same level, same quote) of line i, skipping deeper lines; null at the list's start. */
function prevSibling(lines: string[], i: number): number | null {
  const it = parseItem(lines[i])!;
  const lvl = levelOf(it);
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (!l.slice(it.quote.length).trim()) continue;
    if (!l.startsWith(it.quote)) return null;
    const p = parseItem(l);
    const ind = width(/^[ \t]*/.exec(l.slice(it.quote.length))![0]);
    if (p && levelOf(p) === lvl) return j;
    if (ind < lvl || (!p && ind <= lvl)) return null;
  }
  return null;
}

function nextSibling(lines: string[], i: number): number | null {
  const it = parseItem(lines[i])!;
  const end = blockEnd(lines, i);
  for (let j = end + 1; j < lines.length; j++) {
    if (!lines[j].slice(it.quote.length).trim()) continue;
    const p = parseItem(lines[j]);
    if (p && p.quote === it.quote && levelOf(p) === levelOf(it)) return j;
    return null;
  }
  return null;
}

/** The nearest item above with a smaller level (the parent), or null. */
function parentOf(lines: string[], i: number): number | null {
  const it = parseItem(lines[i])!;
  const lvl = levelOf(it);
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (!l.slice(it.quote.length).trim()) continue;
    if (!l.startsWith(it.quote)) return null;
    const p = parseItem(l);
    if (p && levelOf(p) < lvl) return j;
    const ind = width(/^[ \t]*/.exec(l.slice(it.quote.length))![0]);
    if (!p && ind < lvl) return null;
  }
  return null;
}

/**
 * Renumber the ordered list that line i belongs to, from its first item
 * on. A lazy list ("1. 1. 1.") stays lazy. Returns the lines changed.
 */
function renumber(lines: string[], i: number): void {
  const it = parseItem(lines[i]);
  if (!it || it.kind === "bullet") return;
  let first = i;
  for (let p = prevSibling(lines, first); p !== null; p = prevSibling(lines, p)) {
    const pi = parseItem(lines[p])!;
    if (pi.kind !== it.kind || pi.delim !== it.delim) break;
    first = p;
  }
  const items: number[] = [];
  for (let j: number | null = first; j !== null; j = nextSibling(lines, j)) {
    const pj = parseItem(lines[j])!;
    if (pj.kind !== it.kind || pj.delim !== it.delim) break;
    items.push(j);
  }
  if (items.length < 2) {
    return;
  }
  const nums = items.map((j) => parseItem(lines[j])!.num);
  // Lazy numbering (every item the same number, the list had more than the one just added): keep it.
  const others = nums.filter((_, k) => items[k] !== i);
  if (others.length >= 2 && others.every((n) => n === others[0])) {
    const n0 = others[0];
    for (const j of items) setNumber(lines, j, n0);
    return;
  }
  let n = nums[0];
  for (const j of items) setNumber(lines, j, n++);
}

function setNumber(lines: string[], j: number, n: number): void {
  const p = parseItem(lines[j])!;
  const marker = markerFor(p.kind, n, p.delim, p.marker);
  if (marker === p.marker) return;
  const at = p.quote.length + p.indent.length;
  lines[j] = lines[j].slice(0, at) + marker + lines[j].slice(at + p.marker.length);
}

/** Shift the lines [from, to] by `delta` columns (after the quote); returns the new column of line `from`'s indent. */
function shiftBlock(lines: string[], from: number, to: number, delta: number, quote: string): void {
  for (let j = from; j <= to; j++) {
    const body = lines[j].slice(quote.length);
    if (!body.trim()) continue;
    const ws = /^[ \t]*/.exec(body)![0];
    lines[j] = quote + spaces(width(ws) + delta) + body.slice(ws.length);
  }
}

/* ─── Operations ────────────────────────────────────────────────────── */

const empty = (s: ListState) => s.sel.anchor === s.sel.head;

export function enter(s: ListState): ListState | null {
  if (!empty(s)) return null;
  const L = toLines(s);
  const [li, col] = L.h;
  const line = L.lines[li];
  const it = parseItem(line);
  if (!it) return null;
  // A caret inside the marker counts as at the text's start.
  const c = Math.max(col, it.textStart);
  const before = line.slice(it.textStart, c);
  const after = line.slice(c);
  if (!it.text.trim()) {
    // An empty item: outdent when nested, else end the list.
    if (levelOf(it) > 0 && parentOf(L.lines, li) !== null) return shiftTab(s);
    L.lines[li] = it.quote.trimEnd() === "" ? "" : it.quote;
    return fromLines(L.lines, [li, L.lines[li].length]);
  }
  const task = it.task ? "[ ] " : "";
  const gap = it.gap || " ";
  if (!before.trim() && after.trim()) {
    // At the start of the text: a new empty item above; the caret stays with the text.
    const above = it.quote + it.indent + markerFor(it.kind, it.num, it.delim, it.marker) + gap + task;
    L.lines.splice(li, 0, above);
    renumber(L.lines, li);
    const now = parseItem(L.lines[li + 1])!;
    return fromLines(L.lines, [li + 1, now.textStart]);
  }
  const head = line.slice(0, c).replace(/[ \t]+$/, "");
  const next = it.quote + it.indent + markerFor(it.kind, it.num + 1, it.delim, it.marker) + gap + task;
  L.lines[li] = head;
  L.lines.splice(li + 1, 0, next + after.replace(/^[ \t]+/, ""));
  renumber(L.lines, li + 1);
  const ni = parseItem(L.lines[li + 1])!;
  return fromLines(L.lines, [li + 1, ni.textStart]);
}

export function shiftEnter(s: ListState): ListState | null {
  if (!empty(s)) return null;
  const L = toLines(s);
  const [li, col] = L.h;
  const it = parseItem(L.lines[li]);
  if (!it) return null;
  const line = L.lines[li];
  const c = Math.max(col, it.textStart);
  const pad = it.quote + spaces(contentCol(it) + it.task.length);
  L.lines[li] = line.slice(0, c).replace(/[ \t]+$/, "");
  L.lines.splice(li + 1, 0, pad + line.slice(c).replace(/^[ \t]+/, ""));
  return fromLines(L.lines, [li + 1, pad.length]);
}

/** The item lines a selection touches (the caret's line for an empty one). */
function selectedItems(L: Lines): number[] {
  const from = Math.min(L.a[0], L.h[0]);
  let to = Math.max(L.a[0], L.h[0]);
  // A selection ending at column 0 of a line does not take that line.
  if (to > from && (L.a[0] === to ? L.a[1] : L.h[1]) === 0) to--;
  const out: number[] = [];
  for (let i = from; i <= to; i++) if (parseItem(L.lines[i])) out.push(i);
  return out;
}

/**
 * Keep the selection on the same characters after lines changed their
 * start: on an item line, by how far its text moved; elsewhere by the
 * change in length (an indent added or removed in front).
 */
function keepSel(L: Lines, old: string[], lines: string[]): ListState {
  const adj = ([l, c]: [number, number]): [number, number] => {
    if (old[l] === lines[l]) return [l, c];
    const a = parseItem(old[l]);
    const b = parseItem(lines[l]);
    const d = a && b ? (c >= a.textStart ? b.textStart - a.textStart : 0) : lines[l].length - old[l].length;
    return [l, Math.max(0, Math.min(lines[l].length, c + d))];
  };
  return fromLines(lines, adj(L.a), adj(L.h));
}

export function tab(s: ListState): ListState | null {
  const L = toLines(s);
  const items = selectedItems(L);
  if (!items.length) return null;
  const old = [...L.lines];
  const lines = L.lines;
  // Only the top-most selected items move; their children come along.
  const handled = new Set<number>();
  const deltas = new Map<number, number>();
  for (const i of items) {
    if (handled.has(i)) continue;
    const it = parseItem(lines[i])!;
    const end = blockEnd(lines, i);
    for (let j = i; j <= end; j++) handled.add(j);
    const prev = prevSibling(lines, i);
    // The first item of a list cannot go deeper (Obsidian 1.15.1: no over-indent).
    if (prev === null) continue;
    const p = parseItem(lines[prev])!;
    const delta = contentCol(p) - levelOf(it);
    if (delta <= 0) continue;
    shiftBlock(lines, i, end, delta, it.quote);
    for (let j = i; j <= end; j++) deltas.set(j, lines[j].length - old[j].length);
    // In the new sublist: number after the last child of the item above, else from 1 (or א).
    const now = parseItem(lines[i])!;
    if (now.kind !== "bullet") {
      const sib = prevSibling(lines, i);
      const sp = sib === null ? null : parseItem(lines[sib]);
      setNumber(lines, i, sp && sp.kind === now.kind ? sp.num + 1 : 1);
      renumber(lines, i);
    }
    // The old list closes the gap.
    const after = nextSibling(old, i);
    if (after !== null) renumber(lines, after);
  }
  if (!deltas.size) return { doc: s.doc, sel: s.sel };
  return keepSel(L, old, lines);
}

export function shiftTab(s: ListState): ListState | null {
  const L = toLines(s);
  const items = selectedItems(L);
  if (!items.length) return null;
  const old = [...L.lines];
  const lines = L.lines;
  const handled = new Set<number>();
  const deltas = new Map<number, number>();
  for (const i of items) {
    if (handled.has(i)) continue;
    const it = parseItem(lines[i])!;
    const end = blockEnd(lines, i);
    for (let j = i; j <= end; j++) handled.add(j);
    const parent = parentOf(lines, i);
    if (parent === null) continue;
    const p = parseItem(lines[parent])!;
    const delta = levelOf(p) - levelOf(it);
    // The later siblings in the sublist become this item's children: they keep their place.
    shiftBlock(lines, i, end, delta, it.quote);
    for (let j = i; j <= end; j++) deltas.set(j, lines[j].length - old[j].length);
    const now = parseItem(lines[i])!;
    if (now.kind !== "bullet" || p.kind !== "bullet") {
      if (p.kind === now.kind || now.kind !== "bullet") {
        if (now.kind !== "bullet" && p.kind === now.kind) setNumber(lines, i, p.num + 1);
        renumber(lines, i);
      }
    }
    // Siblings that followed it in the sublist are now its children: renumber them from the start.
    const firstChild = i + 1 <= end ? i + 1 : null;
    if (firstChild !== null && parseItem(lines[firstChild])) renumber(lines, firstChild);
  }
  if (!deltas.size) return { doc: s.doc, sel: s.sel };
  return keepSel(L, old, lines);
}

function move(s: ListState, dir: -1 | 1): ListState | null {
  const L = toLines(s);
  const li = L.h[0];
  if (!parseItem(L.lines[li])) return null;
  // Several lines selected: only when they are one item's block (else the editor's own move).
  const lo = Math.min(L.a[0], L.h[0]);
  const top = lo;
  if (!parseItem(L.lines[top])) return null;
  const end = blockEnd(L.lines, top);
  if (Math.max(L.a[0], L.h[0]) > end) return null;
  const other = dir < 0 ? prevSibling(L.lines, top) : nextSibling(L.lines, top);
  if (other === null) return { doc: s.doc, sel: s.sel };
  const lines = L.lines;
  // The list keeps its first number wherever its items move.
  let first = top;
  for (let p = prevSibling(lines, first); p !== null; p = prevSibling(lines, p)) first = p;
  const startNum = parseItem(lines[first])!.num;
  let out: string[];
  let shift: number;
  if (dir < 0) {
    const a = lines.slice(other, top);
    const b = lines.slice(top, end + 1);
    out = [...lines.slice(0, other), ...b, ...a, ...lines.slice(end + 1)];
    shift = other - top;
  } else {
    const oEnd = blockEnd(lines, other);
    const a = lines.slice(top, end + 1);
    const b = lines.slice(end + 1, oEnd + 1);
    out = [...lines.slice(0, top), ...b, ...a, ...lines.slice(oEnd + 1)];
    shift = oEnd - end;
  }
  const it = parseItem(lines[top])!;
  const before = out.map((l) => l);
  if (it.kind !== "bullet") {
    let f = top + shift;
    for (let p = prevSibling(out, f); p !== null; p = prevSibling(out, p)) f = p;
    setNumber(out, f, startNum);
    renumber(out, f);
  }
  const d = (p: [number, number]): [number, number] => {
    const nl = p[0] + shift;
    const a = parseItem(before[nl]);
    const b = parseItem(out[nl]);
    const o = parseItem(lines[p[0]]);
    return [nl, p[1] + (a && b && o && p[1] >= o.textStart ? b.textStart - a.textStart : 0)];
  };
  return fromLines(out, d(L.a), d(L.h));
}

export const moveUp = (s: ListState) => move(s, -1);
export const moveDown = (s: ListState) => move(s, 1);

export function backspace(s: ListState): ListState | null {
  if (!empty(s)) return null;
  const L = toLines(s);
  const [li, col] = L.h;
  const it = parseItem(L.lines[li]);
  if (!it || col !== it.textStart || col === 0) return null;
  const at = it.quote.length + it.indent.length;
  const line = L.lines[li];
  // The marker (and the task box) goes; the text stays where the indent was.
  L.lines[li] = line.slice(0, at) + line.slice(it.textStart);
  if (it.kind !== "bullet") {
    for (let j = li + 1; j < L.lines.length; j++) {
      const p = parseItem(L.lines[j]);
      if (p && p.quote === it.quote && levelOf(p) === levelOf(it)) {
        renumber(L.lines, j);
        break;
      }
      if (L.lines[j].trim() && !p && width(/^[ \t]*/.exec(L.lines[j].slice(it.quote.length))![0]) <= levelOf(it)) break;
    }
  }
  return fromLines(L.lines, [li, at]);
}

export function toggleTask(s: ListState): ListState | null {
  const L = toLines(s);
  const from = Math.min(L.a[0], L.h[0]);
  const to = Math.max(L.a[0], L.h[0]);
  const deltas = new Map<number, number>();
  for (let i = from; i <= to; i++) {
    const line = L.lines[i];
    if (!line.trim() && from !== to) continue;
    const it = parseItem(line);
    let next: string;
    if (!it) {
      const ws = /^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*)/.exec(line)!;
      next = ws[0] + "- [ ] " + line.slice(ws[0].length);
    } else {
      const at = it.textStart - it.task.length;
      const box = !it.task ? "[ ] " : /\[ \]/.test(it.task) ? "[x] " : "";
      next = line.slice(0, at).replace(/[ \t]*$/, " ") + box + line.slice(it.textStart);
      if (!it.gap) next = line + " " + box;
    }
    deltas.set(i, next.length - line.length);
    L.lines[i] = next;
  }
  const adj = ([l, c]: [number, number]): [number, number] => [l, Math.max(0, c + (deltas.get(l) ?? 0))];
  return fromLines(L.lines, adj(L.a), adj(L.h));
}

/* ─── Bold on a partial selection (1.14) ────────────────────────────── */

/** `**…**` spans of a line (not `***` runs of a thematic break), as [open, close] offsets of the markers. */
function boldSpans(line: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /\*\*(?=\S)([^*]|\*(?!\*))*?\S\*\*|\*\*\S\*\*/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push([m.index, m.index + m[0].length - 2]);
  return out;
}

export function toggleBold(s: ListState): ListState | null {
  const L = toLines(s);
  if (L.a[0] !== L.h[0]) return null; // one line: what the 1.14 fix is about
  const li = L.a[0];
  const line = L.lines[li];
  let from = Math.min(L.a[1], L.h[1]);
  let to = Math.max(L.a[1], L.h[1]);
  const spans = boldSpans(line);
  if (from === to) {
    // Inside a bold span: unbold it all; else bold the word under the caret.
    const inside = spans.find(([o, c]) => from >= o + 2 && from <= c);
    if (inside) {
      const [o, c] = inside;
      L.lines[li] = line.slice(0, o) + line.slice(o + 2, c) + line.slice(c + 2);
      return fromLines(L.lines, [li, from - 2]);
    }
    const w = /[\p{L}\p{M}\p{N}_'׳״"-]*$/u.exec(line.slice(0, from))![0].length;
    const r = /^[\p{L}\p{M}\p{N}_'׳״"-]*/u.exec(line.slice(from))![0].length;
    if (!w && !r) {
      L.lines[li] = line.slice(0, from) + "****" + line.slice(from);
      return fromLines(L.lines, [li, from + 2]);
    }
    from -= w;
    to += r;
    L.lines[li] = line.slice(0, from) + "**" + line.slice(from, to) + "**" + line.slice(to);
    return fromLines(L.lines, [li, L.h[1] + 2]);
  }
  // Selection exactly the markers' content or including the markers: unbold.
  const exact = spans.find(([o, c]) => (from === o + 2 && to === c) || (from === o && to === c + 2));
  if (exact) {
    const [o, c] = exact;
    L.lines[li] = line.slice(0, o) + line.slice(o + 2, c) + line.slice(c + 2);
    return fromLines(L.lines, [li, o], [li, c - 2]);
  }
  // Fully inside one span: that part leaves the bold (the span splits around it).
  const inside = spans.find(([o, c]) => from >= o + 2 && to <= c);
  if (inside) {
    const [o, c] = inside;
    const left = line.slice(o + 2, from);
    const mid = line.slice(from, to);
    const right = line.slice(to, c);
    // Spaces at a bold edge stay outside the markers ("**a** b", not "**a **b").
    const wrap = (t: string) => {
      if (!t.trim()) return t;
      const lead = /^\s*/.exec(t)![0];
      const trail = /\s*$/.exec(t)![0];
      return `${lead}**${t.trim()}**${trail}`;
    };
    const out = line.slice(0, o) + wrap(left) + mid + wrap(right) + line.slice(c + 2);
    const start = line.slice(0, o).length + wrap(left).length;
    L.lines[li] = out;
    return fromLines(L.lines, [li, start], [li, start + mid.length]);
  }
  // Overlapping one or more spans: the union becomes one bold span.
  let a = from;
  let b = to;
  const touched = spans.filter(([o, c]) => o < to && c + 2 > from);
  for (const [o, c] of touched) {
    a = Math.min(a, o);
    b = Math.max(b, c + 2);
  }
  let body = line.slice(a, b);
  // Drop the inner markers, then wrap the whole range once.
  const strip = touched.map(([o, c]) => [o - a, c - a] as [number, number]).sort((x, y) => y[0] - x[0]);
  for (const [o, c] of strip) body = body.slice(0, o) + body.slice(o + 2, c) + body.slice(c + 2);
  const lead = /^\s*/.exec(body)![0];
  const trail = /\s*$/.exec(body)![0];
  const core = body.trim();
  const out = line.slice(0, a) + lead + "**" + core + "**" + trail + line.slice(b);
  L.lines[li] = out;
  const start = a + lead.length + 2;
  return fromLines(L.lines, [li, start], [li, start + core.length]);
}

/* ─── Paste ─────────────────────────────────────────────────────────── */

export function paste(s: ListState, text: string): ListState | null {
  const L = toLines(s);
  const li = L.h[0];
  const it = parseItem(L.lines[li]);
  if (!it) return null;
  const pasted = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const firstItem = parseItem(pasted[0]);
  if (!firstItem) return null;
  // Replace the selection first.
  const from = Math.min(s.sel.anchor, s.sel.head);
  const to = Math.max(s.sel.anchor, s.sel.head);
  const doc = s.doc.slice(0, from) + s.doc.slice(to);
  const L2 = toLines({ doc, sel: { anchor: from, head: from } });
  const line = L2.lines[li];
  const it2 = parseItem(line)!;
  const col = Math.max(L2.h[1], it2.textStart);
  const base = levelOf(firstItem);
  const rebase = (l: string, k: number) => {
    const p = parseItem(l);
    const body = l.slice(p ? p.quote.length : 0);
    const ws = /^[ \t]*/.exec(body)![0];
    const lvl = Math.max(0, width(ws) - base) + levelOf(it2);
    return k === 0 ? body.slice(ws.length) : it2.quote + spaces(lvl) + body.slice(ws.length);
  };
  const out = pasted.map(rebase);
  // On an item with no text yet, the pasted first item replaces its marker (no "- - a").
  const emptyItem = !line.slice(it2.textStart).trim();
  let first: string;
  if (emptyItem) first = it2.quote + it2.indent + out[0];
  else {
    // Into an item's text: the first pasted line's own marker goes, its text joins.
    first = line.slice(0, col) + firstItem.text + line.slice(col);
  }
  const tail = emptyItem ? "" : "";
  const lines = [...L2.lines];
  lines.splice(li, 1, first + tail, ...out.slice(1));
  const lastLine = li + out.length - 1;
  const endCol = out.length === 1 ? (emptyItem ? first.length : col + firstItem.text.length) : lines[lastLine].length;
  const r = fromLines(lines, [lastLine, endCol]);
  if (it2.kind !== "bullet") {
    const L3 = r.doc.split("\n");
    renumber(L3, li);
    return fromLines(L3, [lastLine, endCol]);
  }
  return r;
}

export const SMART_LIST_OPS = { enter, shiftEnter, tab, shiftTab, moveUp, moveDown, backspace, toggleTask, toggleBold } as const;
export type SmartListOp = keyof typeof SMART_LIST_OPS | "paste";

/** Run one operation by name (the golden runner and the keymap use this). */
export function runSmartList(op: SmartListOp, s: ListState, arg?: string): ListState | null {
  if (op === "paste") return paste(s, arg ?? "");
  return SMART_LIST_OPS[op](s);
}
