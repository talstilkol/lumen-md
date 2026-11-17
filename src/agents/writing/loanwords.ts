/**
 * Hebrew alternatives to loanwords (plan W13.W15): academic and legal
 * writers in Hebrew are expected to use Hebrew terms; no editor offers
 * them. Here a loanword in the note ("אימייל", with its prefix letters:
 * "באימייל") gets a Hebrew alternative ("בדוא״ל") — only in the academic
 * register. The default, everyday register, gets none: "מייל" in a
 * message to a friend is fine.
 *
 *  - The register: the note's frontmatter (`register: academic` /
 *    `משלב: אקדמי`) wins over the user's setting.
 *  - Every term can be switched off by the user (`disabledTerms`).
 *  - A suggestion only proposes: the fix keeps the prefix letters, and
 *    when the alternative's gender or number differs the rationale says
 *    to check the agreement, with a lower confidence.
 *
 * The list: ./data/loanwords.ts (CC0, compiled by hand; source and
 * licence documented there).
 */
import { proseTokens } from "./proseMask";
import { LOANWORDS } from "./data/loanwords";
import type { WritingSuggestion } from "./writingSuggestion";
import { normalizeForMatch } from "../../text/hebrew";

export const LOANWORD_AGENT = "loanwords";

export type Register = "everyday" | "academic";

export interface LoanwordOptions {
  register?: Register;
  disabledTerms?: readonly string[];
  lang?: "he" | "en";
}

export interface LoanwordEntry {
  /** The first form: the term's name in settings. */
  term: string;
  forms: string[];
  /** Each alternative's inflections (one or more), best alternative first. */
  alternatives: string[];
  inflections: string[][];
  agree: boolean;
  rare: boolean;
  /** How the article goes on a two-word alternative: "construct" (last word), "adj" (every word), "fixed" (not offered). */
  compound: "construct" | "adj" | "fixed";
}

const norm = (w: string) => normalizeForMatch(w).replace(/['"]/g, "").replace(/-/g, "");

export function parseLoanwords(list: string): LoanwordEntry[] {
  return list
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [forms = "", alts = "", flags = ""] = l.split("|").map((x) => x.trim());
      const f = forms.split(",").map((x) => x.trim()).filter(Boolean);
      const infl = alts.split(",").map((x) => x.split("/").map((y) => y.trim()).filter(Boolean)).filter((x) => x.length);
      return { term: f[0], forms: f, alternatives: infl.map((x) => x[0]), inflections: infl, agree: /\bagree\b/.test(flags), rare: /\brare\b/.test(flags), compound: (/\badj\b/.test(flags) ? "adj" : /\bfixed\b/.test(flags) ? "fixed" : "construct") as LoanwordEntry["compound"] };
    })
    .filter((e) => e.forms.length && e.alternatives.length && !e.alternatives.includes(e.term));
}

let index: Map<string, { e: LoanwordEntry; i: number }> | null = null;
function lookup(): Map<string, { e: LoanwordEntry; i: number }> {
  if (index) return index;
  index = new Map();
  for (const e of parseLoanwords(LOANWORDS)) e.forms.forEach((f, i) => index!.set(norm(f), { e, i }));
  return index;
}

export function loanwordEntries(): LoanwordEntry[] {
  return [...new Set([...lookup().values()].map((v) => v.e))];
}

/** The register a note declares in its frontmatter, if any. */
export function noteRegister(markdown: string): Register | null {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)/.exec(markdown)?.[1];
  if (!fm) return null;
  const m = /^(?:register|משלב)\s*:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(fm);
  if (!m) return null;
  const v = m[1].trim().toLowerCase();
  if (/^(academic|legal|formal|אקדמי|משפטי|רשמי)$/.test(v)) return "academic";
  if (/^(everyday|casual|informal|יומיומי|יומי|לא רשמי)$/.test(v)) return "everyday";
  return null;
}

const PREFIX = /^[והבלמשכ]{1,4}/;

/** Up to `n` letters of a written word, niqqud with them. */
function letters(text: string, n: number): string {
  let i = 0;
  let seen = 0;
  while (i < text.length && seen < n) {
    if (/\p{L}/u.test(text[i])) seen++;
    i++;
  }
  while (i < text.length && /\p{M}/u.test(text[i])) i++;
  return text.slice(0, i);
}

/**
 * The inflection of an alternative that matches a loanword form: by its
 * ending, plural (ים / ות) or feminine (ית / ה), in the order the list
 * gives (sg/pl for two, ms/fs/mp/fp for four).
 */
function inflect(infl: readonly string[], form: string): string {
  const fp = /ות$/.test(form);
  const mp = /ימ$/.test(form);
  const fs = !fp && !mp && /(ית|ה)$/.test(form);
  if (infl.length >= 4) return infl[fp ? 3 : mp ? 2 : fs ? 1 : 0];
  if (infl.length >= 2) return infl[fp || mp ? 1 : 0];
  return infl[0];
}

export function detectLoanwords(markdown: string, opts: LoanwordOptions = {}): WritingSuggestion[] {
  const register = noteRegister(markdown) ?? opts.register ?? "everyday";
  if (register !== "academic") return [];
  const he = opts.lang === "he";
  const off = new Set((opts.disabledTerms ?? []).map(norm));
  const idx = lookup();
  const out: WritingSuggestion[] = [];
  for (const t of proseTokens(markdown)) {
    if (t.heading || !/[א-ת]/.test(t.norm)) continue;
    const n = t.norm.replace(/-/g, "");
    let hit = idx.get(n);
    let pre = 0;
    if (!hit) {
      const m = PREFIX.exec(n);
      for (let k = 1; m && k <= m[0].length && !hit; k++) {
        hit = idx.get(n.slice(k));
        if (hit) pre = k;
      }
    }
    if (!hit || off.has(norm(hit.e.term))) continue;
    const { e } = hit;
    let prefix = letters(t.text, pre);
    let alt = inflect(e.inflections[0], n.slice(pre));
    const multi = alt.includes(" ");
    // The article (the last prefix letter ה) on a two-word alternative: on the last word of a construct
    // (ה+חברת הזנק → חברת ההזנק), on every word of noun + adjective (ה+מועד אחרון → המועד האחרון).
    const article = multi && /ה$/.test(n.slice(0, pre));
    let fixable = true;
    if (article) {
      prefix = letters(t.text, pre - 1);
      const ws = alt.split(" ");
      if (e.compound === "fixed") fixable = false;
      else alt = e.compound === "adj" ? ws.map((w) => `ה${w}`).join(" ") : [...ws.slice(0, -1), `ה${ws[ws.length - 1]}`].join(" ");
    }
    out.push({
      range: { from: t.from, to: t.to },
      kind: "loanword",
      message: he ? `״${t.text}״ → ״${prefix}${alt}״` : `"${t.text}" → "${prefix}${alt}"`,
      rationale: (he
        ? `במשלב אקדמי מקובל מונח עברי: ${e.alternatives.join(" / ")}.` + (e.agree ? " שימו לב להתאמה במין ובמספר." : "") + (e.rare ? " המונח עוד לא מוכר לכל הקוראים." : "") + (article && !fixable ? " אחרי ה״א הידיעה צריך לנסח מחדש." : "")
        : `In academic Hebrew a Hebrew term is expected: ${e.alternatives.join(" / ")}.` + (e.agree ? " Check gender and number agreement." : "") + (e.rare ? " Not every reader knows this term yet." : "") + (article && !fixable ? " After the article, rephrase." : "")),
      confidence: e.agree || e.rare || multi ? 0.6 : 0.8,
      replacement: fixable ? prefix + alt : null,
      agentId: LOANWORD_AGENT,
      model: "rules",
      data: { term: e.term, alternatives: e.inflections.map((x) => x.join("/")), source: "lumen-md CC0 list" },
    });
  }
  return out;
}
