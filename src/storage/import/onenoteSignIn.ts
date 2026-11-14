/**
 * Plan W10.E49: the OneNote sign-in, from the wizard's button to the
 * `/oauth/onenote` redirect and back into the wizard.
 *
 * - The button stores the PKCE verifier and `state` in sessionStorage (this
 *   tab only, removed on the way back, whatever the outcome) and leaves for
 *   Microsoft's sign-in page.
 * - The redirect page checks `state`, swaps the code for tokens and hands
 *   them to the wizard in memory. **Tokens are never written to storage.**
 * - The wizard takes the tokens once, reads the account's OneNote through
 *   Graph and shows the usual review step before anything is written.
 */
import { GraphClient, OneNoteAuthError, authorizeUrl, convertOneNoteGraph, createPkce, exchangeCode, readRedirect, refreshTokens, type OneNoteAuthConfig, type OneNoteImportOptions, type OneNoteTokens } from "./onenoteGraph";
import { importFolderFor, type PreparedImport } from "./commit";
import { linkStats } from "./links";

export const PENDING_KEY = "lumen-onenote-signin";
export const REDIRECT_PATH = "/oauth/onenote";
/** A sign-in started more than this long ago is not finished (the code would have expired anyway). */
const PENDING_MAX_AGE = 15 * 60_000;

interface Pending {
  verifier: string;
  state: string;
  at: number;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const session = (): KV | null => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};

/** Leaving for the sign-in page. One seam, so a test can see where the button goes without leaving. */
export const navigation = { assign: (url: string): void => location.assign(url) };

/** The wizard's button: remember the verifier for this tab, then go to Microsoft. */
export async function startOneNoteSignIn(cfg: OneNoteAuthConfig, deps: { storage?: KV | null; assign?: (url: string) => void; now?: () => number } = {}): Promise<string> {
  const storage = deps.storage === undefined ? session() : deps.storage;
  if (!storage) throw new OneNoteAuthError("this browser blocks session storage, which the sign-in needs", "no_storage");
  const pkce = await createPkce();
  const pending: Pending = { verifier: pkce.verifier, state: pkce.state, at: (deps.now ?? Date.now)() };
  storage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = authorizeUrl(cfg, pkce);
  (deps.assign ?? navigation.assign)(url);
  return url;
}

/** The redirect page: check the answer against this tab's sign-in, then swap the code for tokens. */
export async function finishOneNoteSignIn(href: string, cfg: OneNoteAuthConfig, deps: { storage?: KV | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<OneNoteTokens> {
  const storage = deps.storage === undefined ? session() : deps.storage;
  const now = deps.now ?? Date.now;
  const raw = storage?.getItem(PENDING_KEY) ?? null;
  // One use: whatever happens next, this sign-in is spent.
  storage?.removeItem(PENDING_KEY);
  let pending: Pending | null = null;
  try {
    pending = raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    pending = null;
  }
  if (!pending?.verifier || !pending.state) throw new OneNoteAuthError("no OneNote sign-in was started in this tab", "no_pending");
  if (now() - pending.at > PENDING_MAX_AGE) throw new OneNoteAuthError("the OneNote sign-in took too long; start it again", "expired");
  const code = readRedirect(href, pending.state);
  return exchangeCode(cfg, code, pending.verifier, deps.fetch ?? fetch, now);
}

// ── The hand-off to the wizard, in memory only ───────────────────────

let handoff: OneNoteTokens | null = null;
let handoffError: string | null = null;

export function giveOneNoteTokens(tokens: OneNoteTokens): void {
  handoff = tokens;
  handoffError = null;
}

export function giveOneNoteError(message: string): void {
  handoff = null;
  handoffError = message;
}

/** What the redirect left for the wizard, once. */
export function takeOneNoteHandoff(): { tokens: OneNoteTokens } | { error: string } | null {
  const out = handoff ? { tokens: handoff } : handoffError ? { error: handoffError } : null;
  handoff = null;
  handoffError = null;
  return out;
}

/** An access token that is refreshed (in memory) once it has expired. */
export function tokenSource(cfg: OneNoteAuthConfig, first: OneNoteTokens, deps: { fetch?: typeof fetch; now?: () => number } = {}): () => Promise<string> {
  let current = first;
  const now = deps.now ?? Date.now;
  return async () => {
    if (now() >= current.expiresAt && current.refreshToken) current = await refreshTokens(cfg, current.refreshToken, deps.fetch ?? fetch, now);
    return current.accessToken;
  };
}

/** Read the signed-in account's OneNote into the wizard's review step. Nothing is written yet. */
export async function prepareOneNoteGraphImport(
  cfg: OneNoteAuthConfig,
  tokens: OneNoteTokens,
  opts: OneNoteImportOptions & { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; signal?: AbortSignal } = {},
): Promise<PreparedImport> {
  const graph = new GraphClient(tokenSource(cfg, tokens, opts), { fetch: opts.fetch, sleep: opts.sleep, signal: opts.signal });
  const vault = await convertOneNoteGraph(graph, opts);
  const name = "OneNote";
  return { source: "onenote", detected: "onenote", name, folder: await importFolderFor(name), vault, links: linkStats(vault) };
}
