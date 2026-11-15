/**
 * Where LM Studio answers (plan W11.I17): the one setting the LM Studio
 * executor and the privacy ledger both read, so the ledger names its calls
 * without loading the executor. No imports.
 */

export const LMSTUDIO_URL_KEY = "lumen.ai.lmstudio.url";
export const LMSTUDIO_DEFAULT_URL = "http://localhost:1234";

/** The configured LM Studio base URL (default localhost:1234), without a trailing slash. */
export function lmStudioUrl(): string {
  let v: string | null = null;
  try {
    v = localStorage.getItem(LMSTUDIO_URL_KEY);
  } catch {
    /* why: storage blocked: the default address */
  }
  return (v || LMSTUDIO_DEFAULT_URL).replace(/\/+$/, "");
}
