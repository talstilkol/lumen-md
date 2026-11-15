/**
 * Saved searches (plan W2.12): named queries in the 11.3 syntax, listed in
 * the sidebar; a click opens the search dialog on that query.
 *
 * W12.A4: kept in the vault (`.lumen/searches.json`, ./savedSearchStore.ts),
 * so they sync between devices; the old per-browser localStorage list is
 * moved there once. The API stays synchronous: a change shows at once and
 * the file follows.
 */
import { createSavedSearchStore, SEARCHES_PATH, type SavedSearch } from "./savedSearchStore";
import { isOPFSAvailable, readWorkspaceFile, workspaceHasFile, writeWorkspaceFile } from "../storage/workspace";

export type { SavedSearch };

export const SAVED_SEARCHES_CHANGED = "lumen-saved-searches-changed";
/** Opens the search dialog; `detail.query` fills its box. */
export const OPEN_SEARCH = "lumen-open-search";
const MAX = 100;

const local = (() => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // why: storage blocked (private mode): nothing to migrate
  }
})();

const store = createSavedSearchStore(
  {
    available: isOPFSAvailable,
    read: async () => ((await workspaceHasFile(SEARCHES_PATH).catch(() => false)) ? readWorkspaceFile(SEARCHES_PATH) : null),
    write: (text) => writeWorkspaceFile(SEARCHES_PATH, text).then(() => undefined),
  },
  local,
  { onChange: () => typeof window !== "undefined" && window.dispatchEvent(new Event(SAVED_SEARCHES_CHANGED)) },
);

export function savedSearches(): SavedSearch[] {
  return store.list().slice(0, MAX);
}

/** Read the vault's list again (on open, and after the vault changed or synced). The first time, the old localStorage list moves in. */
export function refreshSavedSearches(): Promise<SavedSearch[]> {
  return store.refresh();
}

/** Every change written to the vault (tests, and before the app closes). */
export const flushSavedSearches = () => store.flush();

/** Save (or rename) a search; the same query is kept once, newest first. */
export function saveSearch(query: string, name?: string): SavedSearch | null {
  return store.save(query, name);
}

export function removeSavedSearch(query: string): void {
  store.remove(query);
}

export function isSaved(query: string): boolean {
  return store.isSaved(query);
}

export function openSearch(query: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH, { detail: { query } }));
}
