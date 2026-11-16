/**
 * The status of every UI language — the single source of truth (plan W4.18,
 * launch P0 #16). English is the source and Hebrew is written by native
 * speakers: those two ship as full languages. The other six were
 * machine-translated (plan 9.1) and are "Beta (machine translation, awaiting
 * native review)" until a native speaker reviews them: the language picker
 * (command palette), onboarding and Settings say so and link to the help
 * page on reporting a translation issue (docsUrl("translations")); the
 * "Suggest a better translation" command opens a prefilled GitHub issue
 * (./suggest.ts), with no server.
 *
 * Everything that asks "is this language full or beta?" reads it here: the
 * picker labels (./localeLabel.ts), isLocaleAvailable() in ./index.ts, the
 * docs table (localeStatus.test.ts checks the docs against this map).
 *
 * When a speaker has reviewed a language, change it here to "reviewed" (and
 * list the reviewer in docs/…/contributing/translations.md).
 *
 * "native" is the status of the language, not a promise for every string: a
 * new Hebrew string may start as a machine draft and is then listed under
 * `he` in i18n/needs-review/ until a native speaker approves it (R8-L8:
 * 7 today, the academic.* strings of the academic export dialog; the docs
 * page names them).
 */
import type { Locale } from "./index";

export type ReviewStatus = "source" | "native" | "reviewed" | "beta";

export const LOCALE_REVIEW: Readonly<Record<Locale, ReviewStatus>> = {
  en: "source",
  he: "native",
  ar: "beta",
  ru: "beta",
  fr: "beta",
  de: "beta",
  ja: "beta",
  "zh-CN": "beta",
};

export const isBetaLocale = (code: string): boolean => LOCALE_REVIEW[code as Locale] === "beta";

/** A full language: the source, native-written, or reviewed by a native speaker. */
export const isFullLocale = (code: string): boolean => {
  const s = LOCALE_REVIEW[code as Locale];
  return s !== undefined && s !== "beta";
};

/** The languages still waiting for a native speaker. */
export const betaLocales = (): Locale[] => (Object.keys(LOCALE_REVIEW) as Locale[]).filter((l) => LOCALE_REVIEW[l] === "beta");

/** The languages that ship as full languages. */
export const fullLocales = (): Locale[] => (Object.keys(LOCALE_REVIEW) as Locale[]).filter(isFullLocale);
