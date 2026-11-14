#!/usr/bin/env node
/**
 * Plan W10.B13: a plan status must not call a synthetic set real.
 *
 *   node scripts/golden/origin-claims.mjs <plan.json>   list the statuses that do (exit 1 when any)
 *
 * `falseRealClaims(text, origins)` is the rule plan:check can call
 * (scripts/plan/build.mjs on chore/dod): a status that names a golden set
 * or fixture whose origin (eval/origins.json) is synthetic, and in the same
 * sentence calls it real ("real", "אמיתי", "from Obsidian", "מ-Obsidian").
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** "Real" said of DATA (not of a real app or library): real corpus / notes / files, קורפוס אמיתי, זהב מ-Obsidian… */
const REAL = /\breal(?:-world)? (?:data|corpus|notes|files|vaults?|exports?|sets?|documents|pairs|queries|golden)\b|\bgolden (?:set )?from Obsidian\b|(?:קורפוס|נתונים|פתקים|קבצים|סט|סטים|מסמכים|זוגות|שאילתות|ייצואים|כספות)\s+(?:אמיתי|אמיתיים|אמיתית|אמיתיות)|זהב\s+מ-?Obsidian/i;

/** The names a status can use for a source: a fixture name, a golden set name, or set/part. */
function namesOf(origins) {
  const out = [];
  for (const [k, v] of Object.entries(origins.fixtures ?? {})) out.push({ name: k.replace(/\.(ts|json)$/, ""), origin: v.origin });
  const bySet = new Map();
  for (const [k, v] of Object.entries(origins.golden ?? {})) {
    out.push({ name: k, origin: v.origin });
    const set = k.split("/")[0];
    bySet.set(set, [...(bySet.get(set) ?? []), v.origin]);
  }
  // A whole set counts as synthetic only when every part is.
  for (const [set, os] of bySet) out.push({ name: set, origin: os.every((o) => o === "synthetic") ? "synthetic" : "mixed" });
  return out;
}

/** Sentences of `text` that call a synthetic source real. */
export function falseRealClaims(text, origins) {
  // Names that are also ordinary words ("golden", "print", "obsidian") would match any sentence.
  const GENERIC = new Set(["golden", "print", "paste", "import", "stack", "latex", "academic", "bases", "chats", "licenses", "ink", "obsidian", "injection", "sefaria", "datagov"]);
  const synthetic = namesOf(origins).filter((n) => n.origin === "synthetic" && n.name.length > 3 && !GENERIC.has(n.name));
  const hits = [];
  for (const sentence of String(text).split(/(?<=[.;!?·])\s+|\n/)) {
    if (!REAL.test(sentence)) continue;
    for (const n of synthetic) {
      const re = new RegExp(`(^|[^\\w-])${n.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`, "i");
      if (re.test(sentence)) hits.push({ name: n.name, sentence: sentence.trim() });
    }
  }
  return hits;
}

function walk(o, fn) {
  if (Array.isArray(o)) o.forEach((x) => walk(x, fn));
  else if (o && typeof o === "object") {
    if (typeof o.id === "string" && typeof o.status === "string") fn(o);
    Object.values(o).forEach((x) => walk(x, fn));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const origins = JSON.parse(readFileSync(resolve(root, "eval/origins.json"), "utf8"));
  const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
  let n = 0;
  walk(plan, (t) => {
    for (const h of falseRealClaims(t.status, origins)) {
      n++;
      console.log(`✖ ${t.id}: calls "${h.name}" real, but its origin is synthetic — ${h.sentence.slice(0, 200)}`);
    }
  });
  if (n) process.exit(1);
  console.log("✓ no plan status calls a synthetic set real");
}
