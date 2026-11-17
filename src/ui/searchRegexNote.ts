/**
 * The line under the search box for what a /regex/ could not check (2.39):
 * notes too long for it (REGEX_MAX_CHARS), or a search stopped at the time
 * limit (REGEX_TIME_LIMIT_MS). Empty when the regex checked every note.
 */
import { formatNumber, t } from "../i18n";
import type { SearchResult } from "../storage/vaultIndexCore";

export function regexNoteText(r: Omit<SearchResult, "hits">): string {
  if (r.regexTimedOut) return t("search.regexTimedOut");
  if (r.regexSkipped) return t("search.regexSkipped", { count: String(r.regexSkipped), limit: formatNumber(r.regexMaxChars ?? 0) });
  return "";
}
