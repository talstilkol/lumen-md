/**
 * Tiny in-process i18n helper. Strings are keyed by a hierarchical id and
 * live in `./locales/<lang>/<domain>.json` (plan 0.3, locales/README.md);
 * missing keys fall back to English (and then to the id itself, so the UI
 * never goes blank).
 */

import { fillTemplate } from "./fill";
import { platformKeys } from "../lib/platformKeys";
import { detectLocale, systemLanguages } from "./detect";
import { isFullLocale } from "./review";
import { resolvePlural } from "./plural";

// β.4 — `Locale` includes the 6 deferred locales so the type is stable
// across the rest of the codebase. Bundles for ar / ru / fr / de / ja /
// zh-CN are lazy-loaded from `src/i18n/locales/<code>/*.json` when one is
// selected; until those JSON files exist the locale entries are filtered
// out of the picker via `isLocaleAvailable`.
export type Locale =
  | "en"
  | "he"
  | "ar"
  | "ru"
  | "fr"
  | "de"
  | "ja"
  | "zh-CN";

export const SUPPORTED_LOCALES: { code: Locale; label: string; dir: "ltr" | "rtl" }[] = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "he", label: "עברית", dir: "rtl" },
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "ru", label: "Русский", dir: "ltr" },
  { code: "fr", label: "Français", dir: "ltr" },
  { code: "de", label: "Deutsch", dir: "ltr" },
  { code: "ja", label: "日本語", dir: "ltr" },
  { code: "zh-CN", label: "简体中文", dir: "ltr" },
];

/**
 * Only English ships synchronously in the main JS chunk (it is the
 * fallback for every missing key). Every other locale — Hebrew included —
 * lives in `./locales/<code>/*.json` and is fetched on demand by
 * `loadLocale()`; `initLocale()` (called from main.tsx before the first
 * render) preloads the persisted locale so the sync `t()` API never
 * flashes English for a returning non-English user. (A7 lever 4.)
 */
const SYNCHRONOUS_LOCALES = new Set<Locale>(["en"]);

/**
 * Returns true when the locale's bundle is usable. The full languages
 * (English and Hebrew) are always available. Other lazy locales count as available only when the
 * bundle is loaded AND has at least one key — this keeps empty
 * placeholder stubs (`{}`) from being mistakenly treated as complete
 * locales (a translator's PR-in-flight shouldn't silently flip the
 * locale "on" for users).
 */
export function isLocaleAvailable(locale: Locale): boolean {
  // The full languages (./review.ts, the one list of which languages are
  // full and which are beta) are first-party and complete — key-for-key with
  // `en`, enforced by the i18nDrift + i18nStrings tests — so they count as
  // available before their chunk has been fetched.
  if (isFullLocale(locale)) return true;
  const bundle = BUNDLES[locale];
  if (!bundle) return false;
  // Ignore underscore-prefixed metadata keys (e.g. _placeholder, _note)
  const realKeys = Object.keys(bundle).filter((k) => !k.startsWith("_"));
  return realKeys.length > 0;
}

type Strings = Record<string, string>;

// English, the fallback for every key, ships in the main chunk: each domain
// file of ./locales/en/ is imported eagerly, so t() stays synchronous.
// Strings are added to those JSON files, not here (plan 0.3; src/i18n/locales/README.md).
const EN_FILES = import.meta.glob<Strings>("./locales/en/*.json", { eager: true, import: "default" });
const en: Strings = Object.assign({}, ...Object.keys(EN_FILES).sort().map((f) => EN_FILES[f]));

/**
 * Every other language: one lazy chunk per domain file. A locale is loaded
 * whole (all its domains in parallel) the first time it is selected.
 */
const LAZY_FILES = import.meta.glob<Strings>(["./locales/*/*.json", "!./locales/en/*.json"], { import: "default" });

/**
 * Locale → bundle map. Only `en` is bundled synchronously (always
 * present in the main JS chunk). The other 7 supported locales are
 * lazy-imported by `loadLocale()` on first use and cached here.
 */
const BUNDLES: Partial<Record<Locale, Strings>> = { en };

let activeLocale: Locale = "en";
/** The direction of a bundle installed under a code SUPPORTED_LOCALES doesn't list (installBundle). */
const EXTRA_DIR: Record<string, "ltr" | "rtl"> = {};

export function getLocale(): Locale {
  return activeLocale;
}

/**
 * Lazy-load a locale's translations: every domain file of the locale, in
 * parallel. Returns the loaded bundle, or falls back to `en` when the
 * locale has no files or any of them fails to load (offline): a locale
 * is cached only whole, so a half-loaded one is never applied.
 * Subsequent calls hit the cache.
 */
export async function loadLocale(locale: Locale): Promise<Strings> {
  const cached = BUNDLES[locale];
  if (cached) return cached;
  const prefix = `./locales/${locale}/`;
  const files = Object.keys(LAZY_FILES)
    .filter((f) => f.startsWith(prefix))
    .sort();
  if (files.length === 0) return en;
  try {
    const parts = await Promise.all(files.map((f) => LAZY_FILES[f]()));
    const bundle: Strings = Object.assign({}, ...parts);
    BUNDLES[locale] = bundle;
    return bundle;
  } catch {
    return en;
  }
}

/**
 * Apply the locale globally and update the document direction. For
 * non-bundled locales, the bundle is fetched in the background and
 * the page re-renders once it lands.
 */
export function applyLocale(locale: Locale): void {
  activeLocale = locale;
  if (typeof document !== "undefined") {
    const meta = SUPPORTED_LOCALES.find((l) => l.code === locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = meta?.dir ?? EXTRA_DIR[locale] ?? "ltr";
  }
  // Kick off an async fetch for non-synchronous locales so subsequent
  // `t()` calls find the bundle. We don't await — `t()` falls back to
  // `en` while the bundle is in flight, then upgrades on next render.
  if (!SYNCHRONOUS_LOCALES.has(locale) && !(locale in BUNDLES)) {
    void loadLocale(locale);
  }
}

/**
 * English for a lazily loaded domain. Its strings live in
 * `src/i18n/lazy/<domain>.json` and ship in that domain's chunk, not in the
 * startup bundle; the domain registers them when it loads (other locales
 * keep the keys in their own JSON as usual). Keys already in `en` win. The
 * i18n tools and tests read these files together with the `en` block.
 */
export function registerEnglish(strings: Strings): void {
  for (const [k, v] of Object.entries(strings)) if (!(k in en)) en[k] = v;
}

/**
 * Every UI string of the active language and of English, as shown (with
 * platform shortcuts). The usability recorder (plan W1.29) keeps a
 * control's label only when it is one of these, so a label that carries
 * someone's text (a note name on a tab) is never recorded.
 */
export function uiStringValues(): Set<string> {
  const out = new Set<string>();
  for (const bundle of [en, BUNDLES[activeLocale] ?? {}]) {
    for (const v of Object.values(bundle)) {
      if (typeof v !== "string" || /\{\w+\}/.test(v)) continue;
      out.add(v);
      out.add(platformKeys(v));
    }
  }
  return out;
}

/**
 * The BCP 47 tag numbers are written with: the UI language, plus the digits
 * the user chose (W13.I5: `-u-nu-arab` for Arabic-Indic digits). The
 * numerals module sets it; plain locale until then.
 */
let numberTag: () => string = () => activeLocale;
export function setNumberLocale(tag: () => string): void {
  numberTag = tag;
}
export function numberLocale(): string {
  return numberTag();
}

/** `n` written for the UI language and the chosen digits. */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(numberTag(), opts).format(n);
  } catch {
    return String(n);
  }
}

/** A count passed as a var: a number, or a string of digits (callers that pass String(n)). */
function countOf(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Translate `id` using the active locale, with optional `{name}` substitutions.
 * A value with a plural block (`{count, plural, one {…} other {…}}`, W13.I2)
 * picks the CLDR form of the active language for `vars[count]`.
 */
export function t(id: string, vars?: Record<string, string | number>): string {
  const bundle = BUNDLES[activeLocale] ?? en;
  const raw = bundle[id] ?? en[id] ?? id;
  // Mac-style shortcuts (⌘K) read as Ctrl+K on Windows / Linux (T45).
  let template = platformKeys(raw);
  if (template.includes("plural")) {
    const arg = /\{\s*(\w+)\s*,\s*plural\s*,/.exec(template)?.[1];
    const n = arg ? countOf(vars?.[arg]) : NaN;
    const locale = raw === bundle[id] ? activeLocale : "en";
    const resolved = resolvePlural(template, Number.isNaN(n) ? Infinity : n, locale, Number.isNaN(n) ? () => String(vars?.[arg ?? ""] ?? "") : formatNumber);
    if (resolved !== null) template = resolved;
  }
  if (!vars) return template;
  return fillTemplate(template, vars);
}

/**
 * Plural-aware translate. `base` holds a plural block (`{n, plural, …}`,
 * W13.I2): every CLDR form of each language in one value, `#` the count.
 * Legacy keys (`${base}.one` / `${base}.other`) still resolve by
 * `Intl.PluralRules` category, falling back to `${base}.other`; the
 * i18n:plurals gate keeps new ones out.
 */
export function tPlural(base: string, n: number, vars?: Record<string, string | number>): string {
  const bundle = BUNDLES[activeLocale] ?? en;
  if (base in bundle || base in en) return t(base, { n, ...vars });
  let category = "other";
  try {
    category = new Intl.PluralRules(activeLocale).select(n);
  } catch {
    /* why: unsupported locale — use "other" */
  }
  const key =
    `${base}.${category}` in bundle || `${base}.${category}` in en
      ? `${base}.${category}`
      : `${base}.other`;
  return t(key, { n, ...vars });
}

/**
 * Tests and pseudo-localisation only (plan W13.I1: en-XA, ar-XB, through
 * src/testing/e2eHooks.ts — a production build drops it with the hooks):
 * a bundle under a code the language picker never lists, then
 * `applyLocale(code)`. Keys it lacks fall back to English as usual.
 */
export function installBundle(code: string, strings: Strings, dir: "ltr" | "rtl"): void {
  BUNDLES[code as Locale] = strings;
  EXTRA_DIR[code] = dir;
}

/** True when `locale`'s strings are in memory (so `t()` can use them). */
export function isLocaleLoaded(locale: Locale): boolean {
  return locale in BUNDLES;
}

function isLocale(x: unknown): x is Locale {
  return SUPPORTED_LOCALES.some((l) => l.code === x);
}

/**
 * Boot-time locale init (main.tsx awaits this before the first render).
 * Reads the persisted store locale (zustand `persist` key), fetches its
 * bundle if it isn't English, and applies it — so the synchronous `t()`
 * calls of the first render already resolve to the right language.
 * Defaults to English on any failure (missing/corrupt storage, offline
 * chunk fetch, unknown code).
 */
export async function initLocale(storageKey = "lumen-md"): Promise<Locale> {
  let persisted: unknown = null;
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as { state?: { locale?: unknown } }) : null;
    persisted = parsed?.state?.locale;
  } catch {
    /* why: corrupt storage — go by the system's languages */
  }
  // Plan W4.10: no saved choice → the system's language (as public/boot.js
  // already set lang/dir before the first paint), so a Hebrew system starts in Hebrew.
  let locale: Locale = isLocale(persisted) ? persisted : detectLocale(null, systemLanguages());
  if (locale !== "en") {
    await loadLocale(locale);
    // The chunk couldn't be fetched (offline, missing): don't apply e.g.
    // `lang="he"` + RTL over English strings — fall back to English.
    if (!isLocaleLoaded(locale)) locale = "en";
  }
  applyLocale(locale);
  return locale;
}

export { detectLocale, systemLanguages };

export function isRTL(): boolean {
  return (SUPPORTED_LOCALES.find((l) => l.code === activeLocale)?.dir ?? EXTRA_DIR[activeLocale]) === "rtl";
}
