/**
 * How a language is named wherever it can be picked (launch P0 #16): the
 * language's own name, and for a beta language (./review.ts) the marker
 * "Beta (machine translation, awaiting native review)" in the interface
 * language. The help link opens the in-app help (it works offline) at the
 * section on reporting a translation issue.
 */
import { SUPPORTED_LOCALES, t } from "./index";
import { isBetaLocale } from "./review";
import { openHelp } from "../ui/HelpButton";

/** The language's own name ("Русский"), or the code when it is not a UI language. */
export const localeName = (code: string): string => SUPPORTED_LOCALES.find((l) => l.code === code)?.label ?? code;

/** "Русский — Beta (machine translation, awaiting native review)" for a beta language; the plain name otherwise. */
export const localeOptionLabel = (code: string): string => {
  const label = localeName(code);
  return isBetaLocale(code) ? t("locale.betaLabel", { label }) : label;
};

/** The help page on beta languages, at "Report a translation issue" (docs-parity checks the section exists in en and he). */
export const openTranslationHelp = (): void => openHelp("contributing/translations#report-a-translation-issue");
