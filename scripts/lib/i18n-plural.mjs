/**
 * The plural gate's logic (plan W13.I2), shared by scripts/i18n-plurals.mjs
 * and its test. The runtime twin is src/i18n/plural.ts; the test holds the
 * two parsers to the same answers on every value of the tree.
 *
 * A counted string holds every CLDR form of its language in one value:
 *   "{count, plural, one {# note} other {# notes}}"
 * and the gate checks, for every such key and every locale, that the value
 * has exactly the categories Intl.PluralRules(locale) needs (plus any `=N`),
 * the same count variable, and every `{var}` of the English in each form.
 */

export const ORDER = ["zero", "one", "two", "few", "many", "other"];
const HEAD = /\{\s*(\w+)\s*,\s*plural\s*,/;

/** { arg, forms, before, after } or null. Same grammar as src/i18n/plural.ts. */
export function parsePlural(text) {
  if (typeof text !== "string") return null;
  const m = HEAD.exec(text);
  if (!m) return null;
  const forms = {};
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

/** The CLDR categories `locale` needs. */
export function requiredCategories(locale) {
  let have = ["other"];
  try {
    have = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  } catch {
    /* why: unknown locale — only "other" */
  }
  return ORDER.filter((c) => have.includes(c));
}

const vars = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

/** A value that mentions plural but doesn't parse (a broken block). */
const looksPlural = (s) => typeof s === "string" && HEAD.test(s);

/** Variables that carry a count. */
export const COUNT_VAR = /^(n|count|total|k|num|\w+Count|nodes|edges|shown|done|failed|added|updated|removed|unchanged|items|files|notes)$/;

/**
 * The count variable of an English value that counts something without a
 * plural block (`{n} notes` → "n"), or null. "{n} of {total}" is a position,
 * not a count of things, and is left alone.
 */
export function countVarWithoutPlural(value) {
  if (typeof value !== "string" || parsePlural(value)) return null;
  for (const m of value.matchAll(/\{(\w+)\}\s+(\p{L}+)/gu)) if (COUNT_VAR.test(m[1]) && !/^(of|s|ms|MB|KB|GB)$/.test(m[2])) return m[1];
  return null;
}
export const countsWithoutPlural = (value) => countVarWithoutPlural(value) !== null;

/**
 * Findings for the whole tree.
 *   en        { key: English }
 *   locales   { lang: { key: value } }   (every language but English)
 *   pending   keys still allowed to count without a plural block (the ratchet)
 * Returns { plural: [keys], problems: [{ key, locale, kind, detail }] }.
 */
export function checkPlurals({ en, locales, pending = [] }) {
  const problems = [];
  const plural = [];
  const add = (key, locale, kind, detail = "") => problems.push({ key, locale, kind, detail });
  for (const [key, value] of Object.entries(en)) {
    if (/\.(one|other)$/.test(key) && `${key.replace(/\.(one|other)$/, "")}.one` in en && `${key.replace(/\.(one|other)$/, "")}.other` in en) {
      if (key.endsWith(".one")) add(key.slice(0, -4), "en", "legacy-keys", "uses .one/.other keys: write one value with a plural block");
      continue;
    }
    const msg = parsePlural(value);
    if (!msg) {
      if (looksPlural(value)) add(key, "en", "malformed", value);
      continue;
    }
    plural.push(key);
    const want = requiredCategories("en");
    const missing = want.filter((c) => !(c in msg.forms));
    if (missing.length) add(key, "en", "missing-form", missing.join(","));
    const enVars = vars(Object.values(msg.forms).join(" ") + msg.before + msg.after);
    for (const [locale, strings] of Object.entries(locales)) {
      const tr = strings[key];
      if (tr === undefined) continue;
      const m = parsePlural(tr);
      if (!m) {
        add(key, locale, looksPlural(tr) ? "malformed" : "no-plural", tr);
        continue;
      }
      if (m.arg !== msg.arg) add(key, locale, "arg", `{${m.arg}} instead of {${msg.arg}}`);
      const need = requiredCategories(locale);
      const miss = need.filter((c) => !(c in m.forms));
      if (miss.length) add(key, locale, "missing-form", miss.join(","));
      const extra = Object.keys(m.forms).filter((c) => !c.startsWith("=") && !need.includes(c));
      if (extra.length) add(key, locale, "extra-form", extra.join(","));
      for (const [sel, text] of Object.entries(m.forms)) {
        const have = vars(text + m.before + m.after);
        const lost = enVars.filter((v) => !have.includes(v));
        if (lost.length) add(key, locale, "missing-var", `${sel}: {${lost.join("}, {")}}`);
      }
    }
  }
  for (const [locale, strings] of Object.entries(locales)) {
    for (const [key, tr] of Object.entries(strings)) if (looksPlural(tr) && !plural.includes(key) && key in en) add(key, locale, "plural-without-english", tr);
  }
  const pendingSet = new Set(pending);
  const counting = Object.keys(en).filter((k) => countsWithoutPlural(en[k])).sort();
  for (const k of counting) if (!pendingSet.has(k)) add(k, "en", "new-count-string", `${en[k]} — write it as {${countVarWithoutPlural(en[k])}, plural, …}`);
  for (const k of pending) if (!counting.includes(k)) add(k, "en", "stale-pending", "no longer a count string: remove it from i18n/plural-pending.json");
  return { plural: plural.sort(), counting, problems };
}
