/**
 * Which interface language to start in (plan W4.10): the saved choice,
 * else the first supported language in the system's list
 * (navigator.languages), else English. public/locale-boot.js does the same
 * before the first paint, so the app never flips direction on start.
 */
import type { Locale } from "./index";

const SUPPORTED: readonly Locale[] = ["en", "he", "ar", "ru", "fr", "de", "ja", "zh-CN"];

export function detectLocale(saved: unknown, languages: readonly string[] | undefined): Locale {
  if (typeof saved === "string" && (SUPPORTED as readonly string[]).includes(saved)) return saved as Locale;
  for (const raw of languages ?? []) {
    const tag = String(raw ?? "").toLowerCase();
    let base = tag.split("-")[0];
    if (base === "iw") base = "he";
    if (base === "zh") {
      if (!/-(tw|hk|mo|hant)\b/.test(tag)) return "zh-CN";
      continue;
    }
    if ((SUPPORTED as readonly string[]).includes(base)) return base as Locale;
  }
  return "en";
}

/** The system's language list, in the browser. */
export function systemLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return list.filter(Boolean) as string[];
}
