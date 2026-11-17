/**
 * The OpenAlex reference lookup behind its Settings switch (plan W12.X3):
 * Settings → Privacy → "Look up the references of a DOI in OpenAlex".
 *
 *  - The switch is off by default. While it is off, a lookup sends nothing
 *    and asks nothing: it returns `off`.
 *  - While it is on, every lookup still asks first (`ask`, a confirm in the
 *    app); declined, nothing is sent.
 *  - Accepted, only the DOI goes to api.openalex.org, through the window's
 *    fetch, which the privacy ledger wraps: the request is recorded there
 *    (category research), and a local-only policy still blocks it.
 *
 * Kept out of the settings export and import (schema: kind "data"), like
 * the other consent switches: an imported file never turns it on.
 */
import { openAlexReferences } from "./openAlex";

export const OPENALEX_ENABLED_KEY = "lumen.openAlex.enabled";

export function openAlexEnabled(): boolean {
  try {
    return localStorage.getItem(OPENALEX_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOpenAlexEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(OPENALEX_ENABLED_KEY, "1");
    else localStorage.removeItem(OPENALEX_ENABLED_KEY);
  } catch {
    /* why: storage blocked (private window): the switch stays off */
  }
}

/** The consent question in the app: a confirm dialog naming the DOI and the host. */
export async function askInApp(doi: string): Promise<boolean> {
  const [{ uiConfirm }, { t }] = await Promise.all([import("../ui/PromptDialog"), import("../i18n"), import("./openAlexStrings")]);
  return uiConfirm({ message: t("openAlex.confirm", { doi }) });
}

export type OpenAlexLookup = { status: "off" | "declined"; dois: [] } | { status: "done"; dois: string[] };

export interface LookupOptions {
  /** Asked before each lookup while the switch is on; false sends nothing. The app's confirm dialog when left out. */
  ask?: (doi: string) => Promise<boolean>;
  /** The transport; the window's (ledger-wrapped) fetch when left out. */
  fetch?: typeof fetch;
  mailto?: string;
}

/** The DOIs `doi` cites, per OpenAlex, only with the switch on and the user's yes for this lookup. */
export async function lookupOpenAlexReferences(doi: string, opts: LookupOptions = {}): Promise<OpenAlexLookup> {
  if (!openAlexEnabled()) return { status: "off", dois: [] };
  if (!(await (opts.ask ?? askInApp)(doi))) return { status: "declined", dois: [] };
  // privacy-ledger: research — api.openalex.org (privacyLedger RULES); only the DOI, with the switch on and the user's yes for this lookup
  const dois = await openAlexReferences(doi, { consent: true, fetch: opts.fetch ?? ((input, init) => globalThis.fetch(input, init)), ...(opts.mailto ? { mailto: opts.mailto } : {}) });
  return { status: "done", dois };
}
