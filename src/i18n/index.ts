/**
 * Tiny in-process i18n helper. Strings live in a single resource map, keyed by
 * a hierarchical id; missing keys fall back to English (and then to the id
 * itself, so the UI never goes blank).
 */

import { platformKeys } from "../lib/platformKeys";
import enApp from "./en/app";
import enFeatures from "./en/features";

// β.4 — `Locale` includes the 6 deferred locales so the type is stable
// across the rest of the codebase. Bundles for ar / ru / fr / de / ja /
// zh-CN are lazy-loaded from `src/i18n/locales/<code>.json` when one is
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
 * lives in `./locales/<code>.json` and is fetched on demand by
 * `loadLocale()`; `initLocale()` (called from main.tsx before the first
 * render) preloads the persisted locale so the sync `t()` API never
 * flashes English for a returning non-English user. (A7 lever 4.)
 */
const SYNCHRONOUS_LOCALES = new Set<Locale>(["en"]);

/**
 * Locales whose JSON bundle is first-party and complete (key-for-key with
 * `en`, enforced by the i18nDrift + i18nStrings tests). They count as
 * available before their chunk has been fetched.
 */
const COMPLETE_LOCALES = new Set<Locale>(["en", "he"]);

/**
 * Returns true when the locale's bundle is usable. English and Hebrew are
 * always available. Other lazy locales count as available only when the
 * bundle is loaded AND has at least one key — this keeps empty
 * placeholder stubs (`{}`) from being mistakenly treated as complete
 * locales (a translator's PR-in-flight shouldn't silently flip the
 * locale "on" for users).
 */
export function isLocaleAvailable(locale: Locale): boolean {
  if (COMPLETE_LOCALES.has(locale)) return true;
  const bundle = BUNDLES[locale];
  if (!bundle) return false;
  // Ignore underscore-prefixed metadata keys (e.g. _placeholder, _note)
  const realKeys = Object.keys(bundle).filter((k) => !k.startsWith("_"));
  return realKeys.length > 0;
}

type Strings = Record<string, string>;

/** The English bundle, assembled from its parts (src/i18n/en/). */
const en: Strings = { ...enApp, ...enFeatures };

/**
 * Locale → bundle map. Only `en` is bundled synchronously (always
 * present in the main JS chunk). The other 7 supported locales are
 * lazy-imported by `loadLocale()` on first use and cached here.
 */
const BUNDLES: Partial<Record<Locale, Strings>> = { en };

let activeLocale: Locale = "en";

export function getLocale(): Locale {
  return activeLocale;
}

/**
 * Lazy-load a locale's translations. Returns the loaded bundle or
 * falls back to `en` when the locale isn't available (e.g. a JSON
 * file hasn't been authored yet). Subsequent calls hit the cache.
 */
export async function loadLocale(locale: Locale): Promise<Strings> {
  const cached = BUNDLES[locale];
  if (cached) return cached;
  try {
    // Vite resolves the dynamic import at build time using a glob; any
    // unauthored locale will fail to import and we fall back to `en`.
    // Vite returns `{ default: T }` for JSON imports; some bundlers
    // return the JSON object directly. Detect via the presence of a
    // recognised i18n key (we know `toolbar.tagline` always exists).
    const mod = (await import(`./locales/${locale}.json`)) as unknown;
    let bundle: Strings;
    if (
      mod &&
      typeof mod === "object" &&
      "default" in mod &&
      typeof (mod as { default: unknown }).default === "object"
    ) {
      bundle = (mod as { default: Strings }).default;
    } else {
      bundle = mod as Strings;
    }
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
    document.documentElement.dir = meta?.dir ?? "ltr";
  }
  // Kick off an async fetch for non-synchronous locales so subsequent
  // `t()` calls find the bundle. We don't await — `t()` falls back to
  // `en` while the bundle is in flight, then upgrades on next render.
  if (!SYNCHRONOUS_LOCALES.has(locale) && !(locale in BUNDLES)) {
    void loadLocale(locale);
  }
}

/** Translate `id` using the active locale, with optional `{name}` substitutions. */
export function t(id: string, vars?: Record<string, string | number>): string {
  const bundle = BUNDLES[activeLocale] ?? en;
  // Mac-style shortcuts (⌘K) read as Ctrl+K on Windows / Linux (T45).
  const template = platformKeys(bundle[id] ?? en[id] ?? id);
  if (!vars) return template;
  // Support both `{key}` (canonical) and `{{key}}` (some early templates
  // accidentally used double-brace syntax). The double-brace form was
  // a real production bug — users saw literal "{5} / {100}" because the
  // outer braces were never stripped. Order matters: substitute the
  // double-brace form FIRST so the regex doesn't leave inner braces
  // behind for the single-brace pass to keep.
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`,
    )
    .replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
    );
}

/**
 * Plural-aware translate. Picks `${base}.${category}` where category comes
 * from `Intl.PluralRules` for the active locale ("one", "two", "few", …),
 * falling back to `${base}.other`. `{n}` is substituted with the count.
 * Bundles only need `.one` + `.other`; locales with richer plural systems
 * (ar, ru) can use a count-neutral `.other` phrasing.
 */
export function tPlural(base: string, n: number, vars?: Record<string, string | number>): string {
  const bundle = BUNDLES[activeLocale] ?? en;
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
  let locale: Locale = "en";
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as { state?: { locale?: unknown } }) : null;
    const persisted = parsed?.state?.locale;
    if (isLocale(persisted)) locale = persisted;
  } catch {
    /* why: corrupt storage — stay on English */
  }
  if (locale !== "en") {
    await loadLocale(locale);
    // The chunk couldn't be fetched (offline, missing): don't apply e.g.
    // `lang="he"` + RTL over English strings — fall back to English.
    if (!isLocaleLoaded(locale)) locale = "en";
  }
  applyLocale(locale);
  return locale;
}

export function isRTL(): boolean {
  return SUPPORTED_LOCALES.find((l) => l.code === activeLocale)?.dir === "rtl";
}
