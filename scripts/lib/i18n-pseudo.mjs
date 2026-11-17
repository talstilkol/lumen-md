/**
 * Pseudo-localisation (plan W13.I1), the way Microsoft and Android test a UI
 * before it is translated:
 *
 *   en-XA  every English string accented (á, ë, ĩ …), 40 % longer and inside
 *          ⟦ ⟧ — so a string shown without brackets was never translated
 *          (hard-coded), and a label that loses its closing ⟧ was cut off.
 *   ar-XB  the same text, right to left (dir="rtl"), so layout that only
 *          works in a left-to-right language shows up with Latin text you
 *          can still read.
 *
 * Built from the English (src/i18n/locales/en + src/i18n/lazy) only when
 * asked (scripts/i18n-pseudo.mjs); never a file under src/i18n/locales/, so
 * never in the language picker or the public build.
 *
 * What is kept as written: {placeholders} and {{placeholders}}, the
 * structure of a plural block ({n, plural, one {…} other {…}}, `#`),
 * `code`, URLs, HTML tags, Markdown link targets, keyboard shortcuts
 * (⌘K, Ctrl+K, Esc …) and emoji.
 */
import { parsePlural } from "./i18n-plural.mjs";

export const PSEUDO_LOCALES = { "en-XA": "ltr", "ar-XB": "rtl" };
export const OPEN = "⟦";
export const CLOSE = "⟧";
/** How much longer a pseudo string is (Microsoft's guideline: +30–50 % for short UI text). */
export const EXPANSION = 0.4;

const ACCENT = {
  a: "á", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "í", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ",
  n: "ñ", o: "ö", p: "þ", q: "ǫ", r: "ŕ", s: "š", t: "ţ", u: "ü", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
  A: "Á", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Í", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ",
  N: "Ñ", O: "Ö", P: "Þ", Q: "Ǫ", R: "Ŕ", S: "Š", T: "Ţ", U: "Ü", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
};

// Kept as written: placeholders, code, URLs, tags, link targets, shortcuts, an ICU `#`.
const KEEP = /\{\{?\w+\}?\}|`[^`]*`|https?:\/\/\S+|<[^>]+>|\]\([^)]*\)|(?:⌘|⌥|⇧|Ctrl\+|Alt\+|Shift\+|Cmd\+)\S*|\b(?:Esc|Enter|Tab)\b|#/g;

function accentText(text) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(KEEP)) {
    out += [...text.slice(last, m.index)].map((ch) => ACCENT[ch] ?? ch).join("") + m[0];
    last = m.index + m[0].length;
  }
  return out + [...text.slice(last)].map((ch) => ACCENT[ch] ?? ch).join("");
}

/** Letters to add so the text is EXPANSION longer, at least one. */
function padding(text) {
  const n = Math.max(1, Math.ceil(text.length * EXPANSION));
  const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  let pad = "";
  for (let i = 0; pad.length < n; i++) pad += (pad ? " " : "") + words[i % words.length];
  return pad.slice(0, n).replace(/ $/, "·");
}

/** One English string as en-XA (accented, longer, bracketed). Plural blocks keep their structure. */
export function pseudoString(text) {
  if (typeof text !== "string" || !text) return text;
  const msg = parsePlural(text);
  if (msg) {
    const forms = Object.entries(msg.forms).map(([sel, form]) => `${sel} {${accentText(form)}}`).join(" ");
    return `${OPEN}${accentText(msg.before)}{${msg.arg}, plural, ${forms}}${accentText(msg.after)} ${padding(text)}${CLOSE}`;
  }
  return `${OPEN}${accentText(text)} ${padding(text)}${CLOSE}`;
}

/** Both pseudo locales from the English strings: { "en-XA": {…}, "ar-XB": {…} }. */
export function buildPseudo(en) {
  const xa = {};
  for (const [k, v] of Object.entries(en)) xa[k] = pseudoString(v);
  // ar-XB: the same strings; the app sets dir="rtl" for it, which is the point of the locale.
  return { "en-XA": xa, "ar-XB": { ...xa } };
}

const placeholders = (s) => [...String(s).matchAll(/\{\{?(\w+)\}?\}/g)].map((m) => m[1]).sort().join(",");

/** Problems with a built pseudo locale against the English (for --check and the test). */
export function checkPseudo(en, built) {
  const out = [];
  for (const code of Object.keys(PSEUDO_LOCALES)) {
    const p = built[code];
    if (!p) {
      out.push(`${code}: not built`);
      continue;
    }
    for (const [k, v] of Object.entries(en)) {
      const s = p[k];
      if (typeof v !== "string" || !v) continue;
      if (typeof s !== "string") out.push(`${code} ${k}: missing`);
      else if (!s.startsWith(OPEN) || !s.endsWith(CLOSE)) out.push(`${code} ${k}: not bracketed`);
      else if (placeholders(s) !== placeholders(v)) out.push(`${code} ${k}: placeholders changed`);
      else if (!!parsePlural(v) !== !!parsePlural(s)) out.push(`${code} ${k}: plural block broken`);
      else if (s.length - 2 < v.length * (1 + EXPANSION) - 1) out.push(`${code} ${k}: not ${EXPANSION * 100}% longer`);
    }
  }
  if (!Object.keys(en).length) out.push("no English strings to build from");
  return out;
}
