/**
 * W13.A1 / review 14 Low 1 (F16): signing in to a remote MCP server from
 * Settings → MCP servers. The OAuth flow runs against a mock authorization
 * server; the loopback listener is a test bridge (the real one is
 * src-tauri/src/oauth_loopback.rs, tested with rustc --test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { McpServers } from "../ui/settings/McpServers";
import McpSignIn from "../ui/settings/McpSignIn";
import { addServer, readServers, STORE_KEY, type McpServerConfig } from "../agents/mcp/servers";
import { authHeaders, NEEDS_COMMAND, platformBridge, signIn, SignInUnavailable, type LoopbackBridge } from "../agents/mcp/signIn";
import { CredentialStore } from "../agents/mcp/oauth";
import { ClientRegistry, wellKnown, type Fetch } from "../agents/mcp/oauthFlow";

const MCP = "https://mcp.example.com/mcp";
const AS = "https://auth.example.com";

function world() {
  const log: string[] = [];
  const meta = { issuer: AS, authorization_endpoint: `${AS}/authorize`, token_endpoint: `${AS}/token`, authorization_response_iss_parameter_supported: true, code_challenge_methods_supported: ["S256"], client_id_metadata_document_supported: true };
  const fetchImpl: Fetch = async (url) => {
    log.push(url);
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url === wellKnown(MCP, "oauth-protected-resource")) return json({ resource: MCP, authorization_servers: [AS] });
    if (url === wellKnown(AS, "oauth-authorization-server")) return json(meta);
    if (url === `${AS}/token`) return json({ access_token: "at-1", token_type: "Bearer", expires_in: 3600 });
    return new Response("", { status: 404 });
  };
  return { log, fetchImpl };
}

/** A loopback bridge that "opens" the URL and answers like the browser coming back with `state` (or another one). */
function bridge(answer: (state: string) => string = (st) => `code=c1&state=${st}&iss=${encodeURIComponent(AS)}`): LoopbackBridge & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    status: () => ({ ok: true }),
    open: async (u) => void opened.push(u),
    wait: async (state, _ms, signal) => {
      await new Promise((r) => setTimeout(r, 5));
      signal?.throwIfAborted();
      return answer(state);
    },
  };
}

const server = (): McpServerConfig => ({ id: "notes", label: "Notes", transport: "http", url: MCP, enabled: false, defaultPermission: "ask", tools: {} });

beforeEach(() => localStorage.clear());

describe("where sign-in cannot run, the card says why (no button that fails)", () => {
  it("web: desktop app only", () => {
    render(<McpSignIn server={server()} bridge={platformBridge(false)} />);
    const p = screen.getByTestId("mcp-signin-unavailable-notes");
    expect(p.dataset.reason).toBe("web");
    expect(p.textContent).toMatch(/desktop app only/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("desktop without the listener's command: needs desktop command (owner: isolation allow-list), and nothing is invoked", async () => {
    const b = platformBridge(true);
    expect(b.status()).toEqual({ ok: false, reason: "needs-command", detail: NEEDS_COMMAND });
    render(<McpSignIn server={server()} bridge={b} />);
    expect(screen.getByTestId("mcp-signin-unavailable-notes").textContent).toMatch(/isolation allow-list/);
    const w = world();
    await expect(signIn(server(), { bridge: b, fetchImpl: w.fetchImpl })).rejects.toBeInstanceOf(SignInUnavailable);
    expect(w.log).toEqual([]); // not even discovery
  });

  it("Settings → MCP servers shows the sign-in state on a server reached by address, and not on a program", async () => {
    addServer({ id: "notes", label: "Notes", transport: "http", url: MCP, defaultPermission: "ask" });
    addServer({ id: "prog", label: "Prog", transport: "stdio", command: "/usr/bin/x", defaultPermission: "ask" });
    render(<McpServers desktop={false} />);
    expect(await screen.findByTestId("mcp-signin-unavailable-notes")).toBeTruthy();
    expect(screen.queryByTestId("mcp-signin-unavailable-prog")).toBeNull();
  });
});

describe("signing in (a loopback bridge that works)", () => {
  it("opens the authorization URL, redeems the code from the loopback redirect, records the issuer, and the token goes to that server only", async () => {
    addServer({ id: "notes", label: "Notes", transport: "http", url: MCP, defaultPermission: "ask" });
    const w = world();
    const b = bridge();
    const onSignedIn = vi.fn();
    const { rerender } = render(<McpSignIn server={readServers()[0]} bridge={b} fetchImpl={w.fetchImpl} onSignedIn={onSignedIn} />);
    const start = screen.getByRole("button", { name: "Sign in" });
    expect(start.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByTestId("mcp-signin-status-notes").textContent).toBe(`Signed in with ${AS}.`));
    expect(screen.getByTestId("mcp-signin-status-notes").getAttribute("role")).toBe("status");
    const u = new URL(b.opened[0]);
    expect(u.origin + u.pathname).toBe(`${AS}/authorize`);
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:47613/oauth/callback");
    expect(u.searchParams.get("resource")).toBe(MCP);
    expect(w.log.filter((x) => x === `${AS}/token`)).toHaveLength(1);
    expect(readServers()[0].issuer).toBe(AS);
    expect(onSignedIn).toHaveBeenCalled();
    expect(authHeaders(readServers()[0])).toEqual({ Authorization: "Bearer at-1" });
    expect(authHeaders({ url: "https://other.example.com/mcp", issuer: AS })).toEqual({});
    expect(authHeaders({ url: MCP, issuer: "https://evil.example.com" })).toEqual({});
    rerender(<McpSignIn server={readServers()[0]} bridge={b} fetchImpl={w.fetchImpl} onSignedIn={onSignedIn} />); // the settings tab re-reads the servers
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
  });

  it("a redirect for another request (wrong state) is refused before any code is sent", async () => {
    const w = world();
    const store = new CredentialStore();
    await expect(signIn(server(), { bridge: bridge(() => `code=evil&state=nope&iss=${encodeURIComponent(AS)}`), fetchImpl: w.fetchImpl, store, registry: new ClientRegistry() })).rejects.toThrow(/state/);
    expect(w.log.includes(`${AS}/token`)).toBe(false);
    expect(store.tokenFor(AS, MCP)).toBeNull();
  });

  it("Cancel stops the wait, and a failure is announced as an alert", async () => {
    const w = world();
    const slow: LoopbackBridge = { status: () => ({ ok: true }), open: async () => undefined, wait: (_s, _ms, signal) => new Promise((_r, rej) => signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))) };
    const { unmount } = render(<McpSignIn server={server()} bridge={slow} fetchImpl={w.fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("mcp-signin-status-notes").textContent).toMatch(/Waiting for the browser/));
    fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    const bad: Fetch = async () => new Response("", { status: 404 });
    render(<McpSignIn server={server()} bridge={bridge()} fetchImpl={bad} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Sign-in failed:/);
  });
});

it("the store key is the one the settings tab reads", () => {
  expect(STORE_KEY).toBe("lumen.mcp.servers");
});
