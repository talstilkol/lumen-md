/**
 * Signing in to a remote MCP server (plan W13.A1; review 14, Low 1): the
 * OAuth flow of ./oauthFlow.ts, driven from Settings → MCP servers.
 *
 *   1. Discovery and the authorization URL (oauthFlow.startAuthorization):
 *      every endpoint https, PKCE S256, `resource`, CIMD, no DCR by default.
 *   2. The system browser opens that URL; the redirect comes back to the
 *      loopback listener (RFC 8252 §7.3, src-tauri/src/oauth_loopback.rs),
 *      which returns only a request whose `state` is the one awaited.
 *   3. The authorization server's metadata is fetched again and the code is
 *      redeemed (oauthFlow.finishAuthorization: iss, state, mix-up checks).
 *   4. The token is kept for this session, keyed by (issuer, server), and
 *      sent only to that server (`authHeaders`).
 *
 * The loopback listener needs the desktop app. On the web there is no
 * listener (a page cannot listen on a port, and the https callback page is
 * not deployed): sign-in is "desktop only". On the desktop the listener's
 * Tauri command is not on the isolation allow-list yet, so the bridge says
 * "needs desktop command (owner: isolation allow-list)" and nothing starts.
 * Every network request goes through the privacy ledger (`ledgerFetch`).
 */
import { CredentialStore, type StoredCredential } from "./oauth";
import { ClientRegistry, discover, finishAuthorization, startAuthorization, type Fetch } from "./oauthFlow";
import type { McpServerConfig } from "./servers";

/** Why sign-in cannot run here. */
export type SignInBlock = "web" | "needs-command";
export type SignInStatus = { ok: true } | { ok: false; reason: SignInBlock; detail: string };

/** The desktop command that would run src-tauri/src/oauth_loopback.rs (owner: lib.rs and the isolation allow-list). */
export const LOOPBACK_COMMAND = "mcp_oauth_loopback_wait";
export const NEEDS_COMMAND = "needs desktop command (owner: isolation allow-list)";
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** The platform side of a sign-in: open the system browser, wait for the loopback redirect. */
export interface LoopbackBridge {
  status(): SignInStatus;
  open(url: string): Promise<void>;
  /** The redirect's query string, once a request with this `state` arrives. */
  wait(state: string, timeoutMs: number, signal?: AbortSignal): Promise<string>;
}

const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * The bridge for this platform. Web: no listener. Desktop: the command is not
 * allow-listed yet, so it reports that and never invokes it.
 */
export function platformBridge(desktop = isDesktop()): LoopbackBridge {
  const status: SignInStatus = desktop ? { ok: false, reason: "needs-command", detail: NEEDS_COMMAND } : { ok: false, reason: "web", detail: "the loopback redirect needs the desktop app" };
  const refuse = async (): Promise<never> => {
    throw new SignInUnavailable(status.ok ? "needs-command" : status.reason);
  };
  return { status: () => status, open: refuse, wait: refuse };
}

export class SignInUnavailable extends Error {
  constructor(readonly reason: SignInBlock) {
    super(reason === "web" ? "sign-in to an MCP server needs the desktop app" : NEEDS_COMMAND);
    this.name = "SignInUnavailable";
  }
}

/** This session's tokens (issuer, server) and client ids (issuer). Not written to disk. */
export const sessionCredentials = new CredentialStore();
export const sessionClients = new ClientRegistry();

/** The fetch every sign-in request goes through: the privacy ledger, listed as network. */
export function ledgerFetchFor(server: Pick<McpServerConfig, "label">): Fetch {
  return (url, init) => import("../../ai/privacyLedger").then(({ ledgerFetch }) => ledgerFetch({ force: { category: "network", reason: `MCP sign-in: ${server.label}` } })(url, init));
}

/** Sign in to `server`; resolves with the credential (also kept in `store`). */
export async function signIn(
  server: Pick<McpServerConfig, "id" | "label" | "url" | "transport">,
  opts: { bridge?: LoopbackBridge; fetchImpl?: Fetch; registry?: ClientRegistry; store?: CredentialStore; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<StoredCredential> {
  if (server.transport !== "http" || !server.url) throw new Error("only a server reached by address can be signed in to");
  const bridge = opts.bridge ?? platformBridge();
  const st = bridge.status();
  if (!st.ok) throw new SignInUnavailable(st.reason);
  const fetchImpl = opts.fetchImpl ?? ledgerFetchFor(server);
  const registry = opts.registry ?? sessionClients;
  const started = await startAuthorization(server.url, { fetchImpl, surface: "desktop", registry });
  opts.signal?.throwIfAborted();
  await bridge.open(started.url);
  const query = await bridge.wait(started.pending.state, opts.timeoutMs ?? SIGN_IN_TIMEOUT_MS, opts.signal);
  opts.signal?.throwIfAborted();
  // The issuer's metadata as it is now: a different issuer or token endpoint (a mix-up) is refused before the code leaves.
  const { meta } = await discover(server.url, fetchImpl);
  const cred = await finishAuthorization(new URLSearchParams(query), started.pending, meta, fetchImpl);
  (opts.store ?? sessionCredentials).set(cred);
  return cred;
}

/** The Authorization header for `server`, only from a token issued for it by its recorded issuer. */
export function authHeaders(server: Pick<McpServerConfig, "url" | "issuer">, store: CredentialStore = sessionCredentials): Record<string, string> {
  if (!server.issuer || !server.url) return {};
  const token = store.tokenFor(server.issuer, server.url);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
