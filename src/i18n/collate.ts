/**
 * Sorting by name the way people read (plan W13.I3), one helper for the file
 * tree, search, Bases and every list:
 *
 *   - by the UI language's rules (Intl.Collator), not by UTF-16 code units;
 *   - numbers as numbers: "פתק 2" before "פתק 10";
 *   - `sensitivity: "base"`: case, accents and Hebrew niqqud don't separate
 *     words, so "שָׁלוֹם" sorts with "שלום" (Obsidian sorted by code unit and
 *     fixed numbers only after years of reports; Hebrew also has niqqud).
 *
 * Collators are cached per locale: creating one per comparison (what
 * `a.localeCompare(b, locale, options)` does) is ~100× slower on 10k notes.
 * `compareCodePoints` is for machine order (ids, hashes, ISO dates in an
 * export), which must not change with the UI language.
 * src/__tests__/localeCollation.test.ts holds the app to it: no
 * `localeCompare` without a locale, no `toLocaleString()` without one.
 */

/**
 * The UI language, as applyLocale() wrote it on <html lang>. Read from the
 * document rather than imported from ./index so a worker or a script that
 * sorts names doesn't pull the English strings in ("en" there).
 */
export function uiLocale(): string {
  return (typeof document !== "undefined" && document.documentElement.lang) || "en";
}

export const NAME_ORDER: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

const collators = new Map<string, Intl.Collator>();

/** The cached name collator of `locale` (default: the UI language). */
export function nameCollator(locale: string = uiLocale()): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    try {
      c = new Intl.Collator(locale, NAME_ORDER);
    } catch {
      c = new Intl.Collator("en", NAME_ORDER);
    }
    collators.set(locale, c);
  }
  return c;
}

/** Compare two names for display order in the UI language (or `locale`). */
export function compareNames(a: string, b: string, locale?: string): number {
  return nameCollator(locale).compare(a ?? "", b ?? "");
}

/** A copy of `items` sorted by name (`key` picks it; default: the item itself). Stable. */
export function sortByName<T>(items: readonly T[], key: (item: T) => string = (x) => String(x), locale?: string): T[] {
  const c = nameCollator(locale);
  return items
    .map((item, i) => ({ item, i, k: key(item) ?? "" }))
    .sort((x, y) => c.compare(x.k, y.k) || x.i - y.i)
    .map((x) => x.item);
}

/** Machine order: by code point, the same in every language (ids, hashes, ISO dates in exports). */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
