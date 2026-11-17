/**
 * Cliché matching (W13.W11) over prose tokens: a phrase matches a run of
 * words in comparison form; in Hebrew the first word may carry prefix
 * letters ("ובסופו של יום"). Lists: ./data/cliches.ts (CC0), plus the
 * user's own; any phrase can be switched off.
 */
import { normalizeForMatch } from "../../text/hebrew";
import { EN_CLICHES, HE_CLICHES } from "./data/cliches";
import type { ProseToken } from "./proseMask";
import type { WritingSuggestion } from "./writingSuggestion";

export interface ClicheOptions {
  /** Extra phrases, `phrase | alternative` or just `phrase`. */
  userCliches?: readonly string[];
  /** Phrases (as listed) the user switched off. */
  disabledCliches?: readonly string[];
  lang?: "he" | "en";
}

export interface ClicheEntry {
  phrase: string;
  words: string[];
  /** undefined = no alternative; "" = cut it. */
  alt?: string;
  source: "builtin" | "user";
}

const norm = (w: string) => normalizeForMatch(w).replace(/['"]/g, "");
const split = (p: string) => p.match(/[\p{L}\p{M}\p{N}]+(?:['’׳״"\-־][\p{L}\p{M}\p{N}]+)*/gu)?.map(norm) ?? [];

export function parseCliches(list: string, source: ClicheEntry["source"]): ClicheEntry[] {
  return list
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const bar = l.indexOf("|");
      const phrase = (bar < 0 ? l : l.slice(0, bar)).trim();
      const alt = bar < 0 ? undefined : l.slice(bar + 1).trim();
      return { phrase, words: split(phrase), alt, source };
    })
    .filter((e) => e.words.length >= 2);
}

let builtin: ClicheEntry[] | null = null;
export function builtinCliches(): ClicheEntry[] {
  return (builtin ??= [...parseCliches(HE_CLICHES, "builtin"), ...parseCliches(EN_CLICHES, "builtin")]);
}

const PREFIX = /^[והבלמשכ]{1,3}/;

function firstMatches(tok: string, want: string): boolean {
  if (tok === want) return true;
  const m = PREFIX.exec(tok);
  if (!m) return false;
  for (let i = 1; i <= m[0].length; i++) if (tok.slice(i) === want) return true;
  return false;
}

/** The first `n` letters of a word as written, with their niqqud. */
function lettersPrefix(text: string, n: number): string {
  let i = 0;
  let seen = 0;
  while (i < text.length && seen < n) {
    if (/\p{L}/u.test(text[i])) seen++;
    i++;
  }
  while (i < text.length && /\p{M}/u.test(text[i])) i++;
  return text.slice(0, i);
}

export function matchCliches(toks: readonly ProseToken[], markdown: string, opts: ClicheOptions = {}): WritingSuggestion[] {
  const off = new Set((opts.disabledCliches ?? []).map((p) => split(p).join(" ")));
  const entries = [...builtinCliches(), ...(opts.userCliches ?? []).flatMap((l) => parseCliches(l, "user"))].filter((e) => !off.has(e.words.join(" ")));
  const byLast = new Map<string, ClicheEntry[]>();
  for (const e of entries) {
    const k = e.words[1];
    byLast.set(k, [...(byLast.get(k) ?? []), e]);
  }
  const he = opts.lang === "he";
  const out: WritingSuggestion[] = [];
  let busyUntil = -1;
  for (let i = 0; i + 1 < toks.length; i++) {
    if (toks[i].from < busyUntil) continue;
    const cands = byLast.get(toks[i + 1].norm);
    if (!cands) continue;
    // Longest phrase first.
    const hit = [...cands]
      .sort((a, b) => b.words.length - a.words.length)
      .find((e) => i + e.words.length <= toks.length && firstMatches(toks[i].norm, e.words[0]) && e.words.every((w, k) => k === 0 || toks[i + k].norm === w) && toks[i + e.words.length - 1].sentence === toks[i].sentence);
    if (!hit) continue;
    const first = toks[i];
    const last = toks[i + hit.words.length - 1];
    const prefixLen = first.norm.length - hit.words[0].length;
    let replacement: string | null = null;
    if (hit.alt !== undefined) {
      // Keep the Hebrew prefix letters ("ובסופו של יום" → "ובסוף"); cutting a phrase also takes the space after it.
      const alt = /^\p{Lu}/u.test(first.text) ? hit.alt.charAt(0).toUpperCase() + hit.alt.slice(1) : hit.alt;
      replacement = hit.alt === "" ? "" : lettersPrefix(first.text, prefixLen) + alt;
    }
    let to = last.to;
    if (replacement === "" && markdown[to] === " ") to++;
    out.push({
      range: { from: first.from, to },
      kind: "cliche",
      message: he ? `קלישאה: ״${hit.phrase}״` : `Cliché: "${hit.phrase}"`,
      rationale: he
        ? hit.alt === "" ? "ביטוי שלא מוסיף מידע; אפשר למחוק אותו." : hit.alt ? `ביטוי שחוק. חלופה פשוטה: ״${hit.alt}״.` : "ביטוי שחוק. נסו לומר את הדבר עצמו במילים שלכם."
        : hit.alt === "" ? "A phrase that adds nothing; it can be cut." : hit.alt ? `A worn phrase. Plainer: "${hit.alt}".` : "A worn phrase. Try saying the thing itself in your own words.",
      confidence: hit.source === "user" ? 0.9 : 0.8,
      replacement,
      agentId: "repetition",
      model: "rules",
      data: { phrase: hit.phrase, source: hit.source },
    });
    busyUntil = last.to;
  }
  return out;
}
