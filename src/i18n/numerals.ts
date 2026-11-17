/**
 * Which digits numbers use (plan W13.I5, W13.I7): Latin (0123) or the
 * language's own — Arabic-Indic for Arabic (٠١٢٣, `-u-nu-arab`), Persian
 * (۰۱۲۳, `-u-nu-arabext`). A per-device choice, set from the palette
 * ("Digits: …") when the UI is Arabic or Persian; the other languages always
 * use their CLDR default. Read by numberLocale() / formatNumber() and every
 * date in src/i18n/format.ts.
 */
export type Numerals = "latn" | "native";

/** The native digit system of the languages that offer a choice, and its default. */
export const NATIVE_DIGITS: Readonly<Record<string, { nu: string; byDefault: Numerals }>> = {
  ar: { nu: "arab", byDefault: "latn" },
  fa: { nu: "arabext", byDefault: "native" },
};

/** One stored key per language, written out so src/settings/schema.ts's scan finds each. */
function stored(locale: string): string | null | undefined {
  if (locale === "ar") return globalThis.localStorage?.getItem("lumen-numerals-ar");
  if (locale === "fa") return globalThis.localStorage?.getItem("lumen-numerals-fa");
  return null;
}
function store(locale: string, value: Numerals): void {
  if (locale === "ar") globalThis.localStorage?.setItem("lumen-numerals-ar", value);
  if (locale === "fa") globalThis.localStorage?.setItem("lumen-numerals-fa", value);
}

/** The saved choice for `locale` (its default when none was saved). */
export function numerals(locale: string): Numerals {
  const native = NATIVE_DIGITS[locale];
  if (!native) return "latn";
  try {
    const saved = stored(locale);
    if (saved === "latn" || saved === "native") return saved;
  } catch {
    /* why: storage blocked — the default */
  }
  return native.byDefault;
}

export function setNumerals(locale: string, value: Numerals): void {
  try {
    store(locale, value);
  } catch {
    /* why: storage blocked — the choice lasts for this session only */
  }
  session[locale] = value;
}
const session: Record<string, Numerals> = {};

/** The tag numbers are written with: `ar-u-nu-arab`, `ar-u-nu-latn`, or the locale itself. */
export function numeralsTag(locale: string): string {
  const native = NATIVE_DIGITS[locale];
  if (!native) return locale;
  const choice = session[locale] ?? numerals(locale);
  return `${locale}-u-nu-${choice === "native" ? native.nu : "latn"}`;
}
