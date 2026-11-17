/**
 * The ```sheet block's model (plan W12.X1): a small spreadsheet kept in the
 * note as CSV, so the note stays plain Markdown that Obsidian shows as a code
 * block. A cell that starts with `=` is a formula on the app's formula engine
 * (src/views/formula, the one Bases and databases use); no new library.
 *
 * References are A1 style: `B3`, `$B$3` (the `$` is accepted and ignored: a
 * block is never copied cell by cell), and ranges `A1:B5`, which become a
 * list, so `SUM(A1:A5)`, `AVERAGE(...)`, `MIN`, `MAX` and `COUNT` work as
 * they do on a list. A circular reference is found before anything is
 * evaluated and every cell on the cycle shows `#CYCLE!`.
 */
import Papa from "papaparse";
import { evaluateFormula, formulaText, type FormulaValue } from "../../views/formula";

export type CellValue = FormulaValue;

export type CellResult =
  | { kind: "empty" }
  | { kind: "value"; value: CellValue; formula?: string }
  | { kind: "error"; code: "#CYCLE!" | "#ERROR!" | "#RANGE!"; message: string; formula: string };

/** At most this many cells in one range (a bound, like the formula engine's own limits). */
export const MAX_RANGE_CELLS = 10_000;

export function parseSheet(source: string): string[][] {
  const text = source.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!text.trim()) return [];
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return parsed.data.map((row) => mergeFormulaFields(row.map((c) => c ?? "")));
}

/** Open parentheses not yet closed, outside quoted text. */
function openParens(s: string): number {
  let depth = 0;
  for (const part of s.split(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) for (const ch of part) depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
  return depth;
}

/**
 * People type `=IF(A1>5, "a", "b")` without CSV quotes. A comma inside a
 * formula's parentheses is an argument separator, not a new cell, so the
 * fields it split are joined back. (The block writes formulas quoted.)
 */
function mergeFormulaFields(row: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < row.length; i++) {
    let cell = row[i];
    if (cell.trimStart().startsWith("=")) while (openParens(cell) > 0 && i + 1 < row.length) cell += "," + row[++i];
    out.push(cell);
  }
  return out;
}

/** The CSV of a grid (formulas included), as the block stores it. */
export function serializeSheet(grid: readonly (readonly string[])[]): string {
  return Papa.unparse(grid.map((r) => [...r]), { newline: "\n" });
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const refName = (row: number, col: number) => `${columnName(col)}${row + 1}`;

/** `B12` → { row: 11, col: 1 }, or null. */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(ref);
  if (!m || Number(m[2]) < 1) return null;
  return { row: Number(m[2]) - 1, col: columnIndex(m[1]) };
}

const STRING = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const RANGE = /\$?([A-Za-z]{1,3})\$?(\d{1,6})\s*:\s*\$?([A-Za-z]{1,3})\$?(\d{1,6})/g;
// A reference is letters then digits, not part of a longer name, and not a function call (`LOG10(`).
const REF = /(?<![\p{L}\p{N}_.])\$?([A-Za-z]{1,3})\$?(\d{1,6})(?![\p{L}\p{N}_(])(?!\s*\()/gu;

export class SheetRangeError extends Error {}

/**
 * The formula (without its `=`) rewritten for the engine: ranges expanded to
 * lists, references upper-cased and `$` dropped. Text in quotes is left alone.
 * Also returns the cells it reads.
 */
export function prepareFormula(formula: string): { source: string; refs: string[] } {
  const refs = new Set<string>();
  let out = "";
  let last = 0;
  const rewrite = (code: string) =>
    code
      .replace(RANGE, (_m, c1: string, r1: string, c2: string, r2: string) => {
        const [a, b] = [columnIndex(c1), columnIndex(c2)].sort((x, y) => x - y);
        const [r, s] = [Number(r1), Number(r2)].sort((x, y) => x - y);
        if ((b - a + 1) * (s - r + 1) > MAX_RANGE_CELLS) throw new SheetRangeError(`range ${c1}${r1}:${c2}${r2} has more than ${MAX_RANGE_CELLS} cells`);
        const cells: string[] = [];
        for (let row = r; row <= s; row++) for (let col = a; col <= b; col++) cells.push(refName(row - 1, col));
        return `[${cells.join(", ")}]`;
      })
      .replace(REF, (_m, c: string, r: string) => {
        const name = `${c.toUpperCase()}${Number(r)}`;
        refs.add(name);
        return name;
      });
  for (const m of formula.matchAll(STRING)) {
    out += rewrite(formula.slice(last, m.index));
    out += m[0];
    last = m.index! + m[0].length;
  }
  out += rewrite(formula.slice(last));
  return { source: out, refs: [...refs] };
}

function literal(raw: string): CellValue {
  const s = raw.trim();
  if (s === "") return null;
  // A number as people type it: 1,234.5 and 12% too.
  const pct = /^(-?[\d,]*\.?\d+)%$/.exec(s);
  if (pct && Number.isFinite(Number(pct[1].replace(/,/g, "")))) return Number(pct[1].replace(/,/g, "")) / 100;
  if (/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  return raw;
}

/**
 * Every cell's result. Formulas are evaluated in dependency order; a cycle is
 * detected (depth-first, with an on-stack set) before evaluation, and each
 * cell on it gets `#CYCLE!` (and so does any formula that reads one).
 */
export function evaluateSheet(grid: readonly (readonly string[])[], now?: Date): CellResult[][] {
  const results: CellResult[][] = grid.map((r) => r.map(() => ({ kind: "empty" }) as CellResult));
  const prepared = new Map<string, { source: string; refs: string[] } | SheetRangeError>();
  const raw = (name: string) => {
    const p = parseRef(name);
    return p ? (grid[p.row]?.[p.col] ?? "") : "";
  };
  const isFormula = (s: string) => s.trimStart().startsWith("=");
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[r].length; c++) {
      const s = grid[r][c];
      if (!isFormula(s)) continue;
      try {
        prepared.set(refName(r, c), prepareFormula(s.trimStart().slice(1)));
      } catch (e) {
        prepared.set(refName(r, c), e as SheetRangeError);
      }
    }

  const done = new Map<string, CellResult>();
  const onStack = new Set<string>();
  const stack: string[] = [];

  const visit = (name: string): CellResult => {
    const hit = done.get(name);
    if (hit) return hit;
    const src = raw(name);
    if (!isFormula(src)) {
      const v = literal(src);
      const res: CellResult = v === null ? { kind: "empty" } : { kind: "value", value: v };
      done.set(name, res);
      return res;
    }
    const formula = src.trimStart();
    const prep = prepared.get(name)!;
    if (prep instanceof SheetRangeError) return finish(name, { kind: "error", code: "#RANGE!", message: prep.message, formula });
    onStack.add(name);
    stack.push(name);
    const fm: Record<string, unknown> = {};
    let cycle = false;
    for (const ref of prep.refs) {
      if (onStack.has(ref)) {
        // Every cell from `ref` up the stack is on the cycle.
        for (const n of stack.slice(stack.indexOf(ref))) done.set(n, { kind: "error", code: "#CYCLE!", message: `circular reference: ${[...stack.slice(stack.indexOf(ref)), ref].join(" → ")}`, formula: raw(n).trimStart() });
        cycle = true;
        break;
      }
      const dep = visit(ref);
      if (dep.kind === "error") {
        cycle = cycle || dep.code === "#CYCLE!";
        stack.pop();
        onStack.delete(name);
        return finish(name, done.get(name) ?? { kind: "error", code: dep.code, message: `${ref}: ${dep.message}`, formula });
      }
      fm[ref] = dep.kind === "value" ? dep.value : null;
    }
    stack.pop();
    onStack.delete(name);
    if (cycle) return done.get(name)!;
    const r = evaluateFormula(prep.source, { fm }, now ? { now } : {});
    return finish(name, r.ok ? { kind: "value", value: r.value, formula } : { kind: "error", code: "#ERROR!", message: r.error.message, formula });
  };
  const finish = (name: string, res: CellResult): CellResult => {
    if (!done.has(name)) done.set(name, res);
    return done.get(name)!;
  };

  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[r].length; c++) {
      const name = refName(r, c);
      results[r][c] = visit(name);
    }
  return results;
}

/** What a cell shows. */
export function displayResult(res: CellResult): string {
  if (res.kind === "empty") return "";
  if (res.kind === "error") return res.code;
  const v = res.value;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  return formulaText(v);
}
