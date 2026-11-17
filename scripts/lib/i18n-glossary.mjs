/**
 * The glossary gate's logic (plan W13.I4), shared by scripts/i18n-glossary.mjs,
 * the draft agent (scripts/lib/i18n-draft.mjs) and the tests.
 *
 * i18n/glossary.json gives each Lumen term one approved translation per
 * language. A translation of an English string that uses the term must
 * contain one of the term's `forms` (a word part, so Hebrew prefixes such as
 * ב / ה / ל and plural endings fit around it) and none of its `avoid`
 * variants ("מאגר" where the term is "כספת"). An untranslated value (the
 * English, word for word) is the values gate's business, not this one's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GLOSSARY_LANGS = ["he", "ar", "ru", "fr", "de", "ja", "zh-CN", "fa"];

export function readGlossary(root) {
  return JSON.parse(readFileSync(join(root, "i18n", "glossary.json"), "utf8"));
}

const lower = (s, lang) => String(s).toLocaleLowerCase(lang);

/** Problems in the glossary file itself (a term without a language, a form the term doesn't contain …). */
export function glossaryShape(glossary) {
  const out = [];
  const ids = new Set();
  for (const term of glossary?.terms ?? []) {
    if (!term.id || ids.has(term.id)) out.push(`term ${term.id ?? "?"}: missing or repeated id`);
    ids.add(term.id);
    try {
      new RegExp(term.match, "iu");
    } catch {
      out.push(`term ${term.id}: bad match`);
    }
    if (!term.definition) out.push(`term ${term.id}: no definition`);
    for (const lang of GLOSSARY_LANGS) {
      const t = term[lang];
      if (!t?.term || !Array.isArray(t.forms) || !t.forms.length) out.push(`term ${term.id}: no ${lang} translation`);
      else if (!t.forms.some((f) => lower(t.term, lang).includes(lower(f, lang)))) out.push(`term ${term.id}: the ${lang} term “${t.term}” has none of its own forms`);
    }
  }
  if (!ids.size) out.push("the glossary has no terms");
  return out;
}

/** The English with its {placeholders} and the term's `ignore` phrases taken out ("{note}" is a variable, "Apple Notes" a product). */
function prose(source, term) {
  let s = String(source)
    .replace(/\{\{?\w+\}?\}/g, " ")
    // `code`, file names and paths (.canvas, templates/, clip-templates.json), search operators (tag:)
    .replace(/`[^`]*`/g, " ")
    .replace(/[\w.-]*[./][\w./-]*|\b\w+:(?=\S)|\b(?:tag|path|file|line):|\b\w+-\w[\w-]*/g, " ");
  if (term.ignore) s = s.replace(new RegExp(term.ignore, "giu"), " ");
  return s;
}

/**
 * Deviations: [{ term, key, lang, kind, level, value, detail }].
 *   avoid    an `avoid` variant is used and the approved term is not        (error; a warning for a non-strict term)
 *   missing  the approved term is not there: an error for a `strict` term
 *            (one meaning in Lumen's English), a warning for one whose English
 *            word has other senses ("meeting notes", "Note:")              (error | warning)
 *   en       { key: English }
 *   locales  { lang: { key: value } }
 */
export function checkGlossary({ glossary, en, locales }) {
  const out = [];
  let checked = 0;
  for (const term of glossary.terms) {
    const re = new RegExp(term.match, "iu");
    for (const [key, source] of Object.entries(en)) {
      if (typeof source !== "string" || !re.test(prose(source, term))) continue;
      for (const lang of GLOSSARY_LANGS) {
        const t = term[lang];
        const value = locales[lang]?.[key];
        if (!t || typeof value !== "string" || !value || value === source) continue;
        checked++;
        // the translation's own {placeholders} and `code` don't count as the term ({tags} is not “tags”)
        const v = lower(value.replace(/\{\{?\w+\}?\}/g, " ").replace(/`[^`]*`/g, " "), lang);
        if (t.forms.some((f) => v.includes(lower(f, lang)))) continue;
        const bad = (t.avoid ?? []).find((a) => v.includes(lower(a, lang)));
        if (bad) out.push({ term: term.id, key, lang, kind: "avoid", level: term.strict === false ? "warning" : "error", value, detail: `“${bad}” instead of “${t.term}”` });
        else out.push({ term: term.id, key, lang, kind: "missing", level: term.strict === false ? "warning" : "error", value, detail: `no “${t.term}”` });
      }
    }
  }
  return { deviations: out, checked };
}

/** The glossary as lines for a model prompt: `vault → כספת (not: מאגר)`. */
export function glossaryPrompt(glossary, lang) {
  return glossary.terms
    .filter((t) => t[lang])
    .map((t) => `${t.en} → ${t[lang].term}${t[lang].avoid?.length ? ` (not: ${t[lang].avoid.join(", ")})` : ""}`)
    .join("; ");
}

/** The Markdown table for the Help translate page. */
export function glossaryTable(glossary, { heading = "Term", meaning = "Meaning" } = {}) {
  const names = { he: "עברית", ar: "العربية", ru: "Русский", fr: "Français", de: "Deutsch", ja: "日本語", "zh-CN": "简体中文" };
  const rows = [
    `| ${heading} | ${meaning} | ${GLOSSARY_LANGS.map((l) => names[l]).join(" | ")} |`,
    `|---|---|${GLOSSARY_LANGS.map(() => "---").join("|")}|`,
  ];
  for (const t of glossary.terms) rows.push(`| ${t.en} | ${t.definition} | ${GLOSSARY_LANGS.map((l) => t[l].term).join(" | ")} |`);
  return rows.join("\n");
}
