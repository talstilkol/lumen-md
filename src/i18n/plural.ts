/**
 * CLDR plural forms in a message (plan W13.I2), in the ICU MessageFormat
 * syntax every translation tool reads (Weblate, Crowdin, Lokalise):
 *
 *   "{count, plural, one {# note} two {# notes} other {# notes}}"
 *
 * One key holds every form its language needs, so a language with six
 * forms (Arabic: zero, one, two, few, many, other) needs no keys English
 * lacks, and the i18n gate (scripts/i18n-plurals.mjs) can check that each
 * locale's value has exactly the categories of
 * `Intl.PluralRules(locale).resolvedOptions().pluralCategories`.
 * `=N` picks an exact count before the category. `#` is the count,
 * formatted for the locale. Text around the plural block is kept, and
 * other `{vars}` inside a form are filled afterwards by `t()`.
 *
 * Dependency-free, so the render worker and the scripts can share it.
 */

export const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

export interface PluralMessage {
  /** The variable that carries the count (`count` in `{count, plural, …}`). */
  arg: string;
  /** Selector (`one`, `few`, `=0` …) → the form's text. */
  forms: Record<string, string>;
  /** Text before and after the plural block. */
  before: string;
  after: string;
}

const HEAD = /\{\s*(\w+)\s*,\s*plural\s*,/;

/** The plural block of `text`, or null when it has none (or it is malformed). */
export function parsePlural(text: string): PluralMessage | null {
  if (typeof text !== "string") return null;
  const m = HEAD.exec(text);
  if (!m) return null;
  const forms: Record<string, string> = {};
  let i = m.index + m[0].length;
  const len = text.length;
  const ws = () => {
    while (i < len && /\s/.test(text[i])) i++;
  };
  for (;;) {
    ws();
    if (i >= len) return null;
    if (text[i] === "}") break;
    const sel = /^(=\d+|zero|one|two|few|many|other)/.exec(text.slice(i));
    if (!sel) return null;
    i += sel[0].length;
    ws();
    if (text[i] !== "{") return null;
    let depth = 1;
    const start = ++i;
    while (i < len && depth) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    if (depth) return null;
    if (sel[0] in forms) return null;
    forms[sel[0]] = text.slice(start, i - 1);
  }
  if (!("other" in forms)) return null;
  return { arg: m[1], forms, before: text.slice(0, m.index), after: text.slice(i + 1) };
}

const RULES = new Map<string, Intl.PluralRules>();

/** The CLDR category of `n` in `locale` ("other" when the runtime doesn't know the locale). */
export function pluralCategory(locale: string, n: number): string {
  try {
    let r = RULES.get(locale);
    if (!r) RULES.set(locale, (r = new Intl.PluralRules(locale)));
    return r.select(n);
  } catch {
    return "other";
  }
}

/** The categories `locale` needs, in CLDR order. */
export function requiredCategories(locale: string): PluralCategory[] {
  let have: string[] = ["other"];
  try {
    have = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  } catch {
    /* why: unknown locale — only "other" */
  }
  return PLURAL_CATEGORIES.filter((c) => have.includes(c));
}

/**
 * `text` with its plural block resolved for `n`, or null when `text` has
 * no plural block. `format` writes the count (default: the locale's digits).
 */
export function resolvePlural(text: string, n: number, locale: string, format?: (n: number) => string): string | null {
  const msg = parsePlural(text);
  if (!msg) return null;
  const exact = msg.forms[`=${n}`];
  const form = exact ?? msg.forms[pluralCategory(locale, n)] ?? msg.forms.other;
  let shown: string;
  try {
    shown = format ? format(n) : new Intl.NumberFormat(locale).format(n);
  } catch {
    shown = String(n);
  }
  return msg.before + form.replace(/#/g, shown) + msg.after;
}
