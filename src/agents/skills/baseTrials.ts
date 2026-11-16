/**
 * Plan W7.1 acceptance 2: "Claude Code that has `lumen-skills` writes a
 * .base file that opens in Lumen without an error in 10/10 tries". This is
 * the judge: every file an outside agent wrote is parsed by Lumen's own
 * Bases engine (views/bases/base.ts) and every view is run over a small
 * synthetic vault. A try passes only when the file parses, has at least one
 * view, and every view runs with no error. The driver that asks the agent
 * (scripts/skills/claude-base-trials.mjs) and the Mac pack
 * (plan/mac-pack/L6.json, W7.1) call this.
 */
import { basesFileFromText, parseBase, runBase } from "../../views/bases/base";

/** The ten tasks the agent gets, one per try. Each names the notes of TRIAL_VAULT it should show. */
export const BASE_TRIAL_PROMPTS: readonly string[] = [
  "Write tasks.base: a table of the notes in the Tasks folder with status and priority, sorted by priority, highest first.",
  "Write open.base: every note in Tasks whose status is not done, as a table with a column for status.",
  "Write books.base: the notes tagged book as cards, with author and year.",
  "Write reading.base: the notes tagged book, grouped by rating, with a count summary.",
  "Write hebrew.base: a table of the notes whose author field is filled, showing the author, in Hebrew column names.",
  "Write recent.base: the notes with a year of 2000 or later, sorted by year, newest first.",
  "Write two-views.base: one table of the Tasks folder and one list of the notes tagged book.",
  "Write priority.base: Tasks notes with a formula column that says high when priority is above 1 and low otherwise.",
  "Write done.base: a table of the Tasks notes whose status is done, limited to 50 rows.",
  "Write all.base: every note in the vault as a table with the file name and its tags.",
];

/** The vault the views run over (SYNTHETIC): two tasks and two books, one with a Hebrew author. */
export const TRIAL_VAULT = [
  { path: "Tasks/a.md", text: "---\nstatus: todo\npriority: 2\n---\n# a\n" },
  { path: "Tasks/b.md", text: "---\nstatus: done\npriority: 1\n---\n# b\n" },
  { path: "Reading/book.md", text: "---\ntags: [book]\nauthor: עמוס עוז\nyear: 2002\nrating: 5\n---\n# סיפור על אהבה וחושך\n" },
  { path: "Reading/other.md", text: "---\ntags: [book]\nauthor: Amos Oz\nyear: 1968\nrating: 4\n---\n# My Michael\n" },
] as const;

export interface BaseTry {
  name: string;
  /** null: the agent wrote no .base file in this try. */
  text: string | null;
}

export interface BaseTryResult {
  name: string;
  ok: boolean;
  views: number;
  error?: string;
}

export interface BaseTrialsReport {
  task: "W7.1";
  tries: number;
  opened: number;
  /** The acceptance: at least `need` tries, and every one of them opened. */
  pass: boolean;
  need: number;
  results: BaseTryResult[];
}

export function checkBaseTry(t: BaseTry): BaseTryResult {
  if (t.text === null || !t.text.trim()) return { name: t.name, ok: false, views: 0, error: "no .base file was written" };
  const p = parseBase(t.text);
  if (!p.ok) return { name: t.name, ok: false, views: 0, error: `parse: ${p.error}` };
  const views = p.base.views.length;
  if (!views) return { name: t.name, ok: false, views: 0, error: "the file has no view" };
  const notes = TRIAL_VAULT.map((n) => basesFileFromText(n.path, n.text));
  for (let v = 0; v < views; v++) {
    let errors: unknown[];
    try {
      errors = runBase(p.base, notes, { view: v }).errors;
    } catch (e) {
      return { name: t.name, ok: false, views, error: `view ${v}: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (errors.length) return { name: t.name, ok: false, views, error: `view ${v}: ${JSON.stringify(errors).slice(0, 300)}` };
  }
  return { name: t.name, ok: true, views };
}

export function checkBaseTrials(tries: readonly BaseTry[], need = 10): BaseTrialsReport {
  const results = tries.map(checkBaseTry);
  const opened = results.filter((r) => r.ok).length;
  return { task: "W7.1", tries: results.length, opened, need, pass: results.length >= need && opened === results.length, results };
}
