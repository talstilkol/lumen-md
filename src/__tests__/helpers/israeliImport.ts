/**
 * The Israeli import scorecard (lane T8): one fixture is one export or one
 * clipboard, written by us (no third-party content) in the shape the app
 * writes, with the vault a person would expect by hand (the oracle). A
 * fixture passes when lumen-md's vault
 *  - passes the import:diff gate against the oracle (scripts/lib/importDiff.mjs:
 *    notes, attachments, links, headings, tasks, Hebrew word for word with its
 *    nikud, direction marks), and
 *  - has the oracle's structure exactly: headings (level, text), list items
 *    (depth, kind, text), table rows (cell by cell), links (text and target), and
 *  - keeps every nikud mark, and every word of every script (Hebrew, Latin,
 *    digits) in the oracle's reading order — so a mixed-direction line that
 *    lost or reordered a word fails, and
 *  - has every front-matter property of the oracle's note, with its value.
 *
 * It is a proxy for the plan's 18/18 real-exports gate (W10.O9, W11.M12),
 * not that gate: those exports come from contributors and run on the Mac.
 * The file is the same on every fix/t8-import-* branch.
 */
// @ts-expect-error — plain .mjs helpers without types
import { compareVaults } from "../../../scripts/lib/importDiff.mjs";
import { readMarkdown } from "../fixtures/real-corpus/fidelity";
import { parse as parseYaml } from "yaml";

export type Vault = Map<string, string | Uint8Array>;

const NIKUD = /[֑-ׇ]/g;
const body = (md: string) => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
const isNote = (p: string) => /\.(md|markdown)$/i.test(p);

/** Words of every script, NFC, in reading order: Hebrew (with nikud and geresh/gershayim inside), Latin, Arabic, digits. */
export function words(md: string): string[] {
  const plain = body(md)
    .normalize("NFC")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[‎‏‪-‮⁦-⁩]/g, "");
  return plain.match(/[א-ת֑-ׇ]+(?:["'׳״][א-ת֑-ׇ]+)*|[؀-ۿ]+|[A-Za-zÀ-ɏ]+|\d+/g) ?? [];
}

function lcs(a: string[], b: string[]): number {
  let prev = new Uint32Array(b.length + 1);
  for (const w of a) {
    const cur = new Uint32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) cur[j] = w === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

export interface FixtureResult {
  name: string;
  pass: boolean;
  problems: string[];
}

const text = (v: string | Uint8Array) => (typeof v === "string" ? v : new TextDecoder().decode(v));
const key = (x: unknown) => JSON.stringify(x);
const decoded = (href: string) => {
  try {
    return decodeURI(href).normalize("NFC");
  } catch {
    return href;
  }
};
/** Front matter as an object ({} when there is none). */
function props(md: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  try {
    return (parseYaml(m[1]) as Record<string, unknown>) ?? {};
  } catch {
    return { "(front matter)": "unreadable" };
  }
}
const norm = (s: string) =>
  s
    .normalize("NFC")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[*_`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
/**
 * The structure readMarkdown reads; links read here, compared by where they
 * lead (decoded), the destination bare or in angle brackets (`[a](<b c.md>)`).
 */
function structure(md: string) {
  const s = readMarkdown(body(md));
  const links = [...body(md).matchAll(/(?<!!)\[([^\]]*)\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)].map((m) => ({ text: norm(m[1]), href: decoded(m[2] ?? m[3]) }));
  return { ...s, links };
}

/** Score lumen-md's vault for one fixture against the oracle's. */
export function scoreVault(name: string, lumen: Vault, oracle: Vault): FixtureResult {
  const problems: string[] = [];
  const diff = compareVaults(lumen, oracle);
  for (const r of diff.rows) if (r.status === "fail") problems.push(`import:diff ${r.metric}: ${r.reason}${r.missingWords ? ` — missing ${r.missingWords.join(", ")}` : ""}`);
  for (const [path, want] of oracle) {
    if (!isNote(path)) {
      if (!lumen.has(path)) problems.push(`attachment ${path}: missing`);
      continue;
    }
    const got = lumen.get(path);
    if (got === undefined) {
      problems.push(`note ${path}: missing (lumen-md wrote ${[...lumen.keys()].filter(isNote).join(", ") || "none"})`);
      continue;
    }
    const w = structure(text(want));
    const g = structure(text(got));
    for (const f of ["headings", "items", "rows", "links"] as const) {
      const ws = w[f].map(key);
      const gs = g[f].map(key);
      const lost = ws.filter((x) => {
        const i = gs.indexOf(x);
        if (i < 0) return true;
        gs.splice(i, 1);
        return false;
      });
      if (lost.length) problems.push(`${path} ${f}: lost ${lost.join(" ")}${gs.length ? `; got instead ${gs.join(" ")}` : ""}`);
    }
    const nw = (text(want).match(NIKUD) ?? []).length;
    const ng = (text(got).match(NIKUD) ?? []).length;
    if (ng < nw) problems.push(`${path} nikud: ${ng} of ${nw} marks`);
    const wp = props(text(want));
    const gp = props(text(got));
    for (const [k, v] of Object.entries(wp)) if (key(gp[k]) !== key(v)) problems.push(`${path} property ${k}: ${key(gp[k])}, not ${key(v)}`);
    const ww = words(text(want));
    const gw = words(text(got));
    const kept = lcs(ww, gw);
    if (kept < ww.length) problems.push(`${path} words in order: ${kept} of ${ww.length}`);
  }
  return { name, pass: problems.length === 0, problems };
}

/** One note each side (a paste, or one chat note). */
export const scoreNote = (name: string, lumen: string, oracle: string): FixtureResult =>
  scoreVault(name, new Map([["note.md", lumen]]), new Map([["note.md", oracle]]));

/** "Word 3/3 · …" and the problems of the fixtures that failed. */
export function scoreLine(results: FixtureResult[]): string {
  const pass = results.filter((r) => r.pass).length;
  return [`${pass}/${results.length}`, ...results.filter((r) => !r.pass).map((r) => `  ✗ ${r.name}: ${r.problems.join(" | ")}`)].join("\n");
}
