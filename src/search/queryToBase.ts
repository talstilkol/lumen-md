/**
 * "Save as Base" for a saved search (plan W12.A4): a query whose every
 * operator has a Bases equivalent becomes an Obsidian `.base` file, so it
 * opens as a table and embeds anywhere with `![[name.base]]` (a dashboard
 * note, W12.V6).
 *
 *   tag:x      → file.hasTag("x")          (nested tags too, as in search)
 *   path:a/    → file.path.lower().contains("a/")
 *   -op        → !(…)
 *
 * Free words, "phrases", /regexes/ and -words search the text, which Bases
 * does not read: such a query stays a saved search, and the reason is given.
 */
import { parseQuery } from "./queryOps";

export type QueryBase = { ok: true; text: string; filters: string[] } | { ok: false; unsupported: string[] };

const str = (s: string) => JSON.stringify(s);

export function queryToBase(name: string, query: string): QueryBase {
  const q = parseQuery(query);
  const unsupported: string[] = [...q.invalid];
  // Free words (a wanted phrase's words are in `text` too: it is reported once, as the phrase).
  let free = q.text;
  for (const op of q.ops) if (op.kind === "phrase" && !op.negate) free = free.replace(op.value, " ");
  if (free.trim()) unsupported.push(free.trim());
  const filters: string[] = [];
  for (const op of q.ops) {
    let f: string | null = null;
    if (op.kind === "tag") f = `file.hasTag(${str(op.value)})`;
    else if (op.kind === "path") f = `file.path.lower().contains(${str(op.value)})`;
    else unsupported.push(op.kind === "regex" ? `${op.negate ? "-" : ""}/${op.re.source}/` : op.kind === "phrase" ? `${op.negate ? "-" : ""}"${op.value}"` : `-${op.value}`);
    if (f) filters.push(op.negate ? `!${f}` : f);
  }
  if (unsupported.length || !filters.length) return { ok: false, unsupported: unsupported.length ? unsupported : [query] };
  const yamlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const text = ["# Saved search: " + query.replace(/\n/g, " "), "filters:", "  and:", ...filters.map((f) => `    - ${yamlStr(f)}`), "views:", "  - type: table", `    name: ${yamlStr(name)}`, "    order: [file.name, file.mtime]", ""].join("\n");
  return { ok: true, text, filters };
}
