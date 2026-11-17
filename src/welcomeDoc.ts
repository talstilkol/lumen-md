/**
 * The welcome document in the UI language (T45): Hebrew for a Hebrew UI,
 * English otherwise, with Mac-style shortcuts rewritten for Windows / Linux.
 */
import { getLocale } from "./i18n";
import { platformKeys } from "./lib/platformKeys";
import { WELCOME_DOC } from "./welcome";
import { WELCOME_DOC_HE } from "./welcome.he";

/** Welcome notes and templates of the languages that load them lazily (Arabic, Persian: src/i18n/rtlExtras.ts). */
const LAZY_WELCOME: Record<string, string> = {};
const LAZY_TEMPLATES: Record<string, Record<string, { name: string; content: string }>> = {};

export function registerRtlContent(locale: string, welcome: string | null, templates: Record<string, { name: string; content: string }>): void {
  if (welcome) LAZY_WELCOME[locale] = welcome;
  LAZY_TEMPLATES[locale] = templates;
}

/** A built-in template in `locale`, when that language has its own version (W13.I5). */
export function localizedTemplate(id: string, locale: string = getLocale()): { name: string; content: string } | null {
  return LAZY_TEMPLATES[locale]?.[id] ?? null;
}

export function welcomeDoc(locale: string = getLocale()): string {
  return platformKeys(locale === "he" ? WELCOME_DOC_HE : (LAZY_WELCOME[locale] ?? WELCOME_DOC));
}
