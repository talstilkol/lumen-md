/**
 * W13.A1: MCP client authorization per the 2026-07-28 spec, against a mock
 * authorization server — iss (RFC 9207) checked before the code is
 * redeemed, CIMD instead of dynamic registration, issuer-bound client ids,
 * application_type native with a loopback redirect, PKCE and resource.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ClientRegistry, discover, finishAuthorization, LOOPBACK_REDIRECT, redirectUriFor, refresh, registrationFor, startAuthorization, WEB_REDIRECT, wellKnown, type Fetch } from "../agents/mcp/oauthFlow";
import { CLIENT_ID, pkceChallenge } from "../agents/mcp/oauth";

const MCP = "https://mcp.example.com/mcp";
const AS = "https://auth.example.com";

/** A mock MCP server + authorization server. Every request is logged. */
function world(opts: { cimd?: boolean; dcr?: boolean; asIssuer?: string; prmResource?: string } = {}) {
  const log: Array<{ url: string; method: string; body?: string; redirect?: string }> = [];
  const meta = {
    issuer: opts.asIssuer ?? AS,
    authorization_endpoint: `${AS}/authorize`,
    token_endpoint: `${AS}/token`,
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ["S256"],
    ...(opts.cimd !== false ? { client_id_metadata_document_supported: true } : {}),
    ...(opts.dcr ? { registration_endpoint: `${AS}/register` } : {}),
  };
  const fetchImpl: Fetch = async (url, init) => {
    log.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined, redirect: init?.redirect as string | undefined });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    if (url === wellKnown(MCP, "oauth-protected-resource") || url === "https://mcp.example.com/prm") return json({ resource: opts.prmResource ?? MCP, authorization_servers: [AS], scopes_supported: ["notes.read"] });
    if (url === wellKnown(AS, "oauth-authorization-server")) return json(meta);
    if (url === `${AS}/register`) return json({ client_id: "dcr-client-1" }, 201);
    if (url === `${AS}/token`) {
      const f = new URLSearchParams(init!.body as string);
      if (f.get("grant_type") === "refresh_token") return json({ access_token: "at-2", token_type: "Bearer", expires_in: 60 });
      return json({ access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", expires_in: 3600 });
    }
    return new Response("not found", { status: 404 });
  };
  return { log, meta, fetchImpl, calls: (path: string) => log.filter((l) => l.url.endsWith(path)) };
}

describe("client registration", () => {
  it("our client metadata document is a native app with the loopback and web redirects", () => {
    const doc = JSON.parse(readFileSync("public/oauth/client-metadata.json", "utf8"));
    expect(doc.client_id).toBe(CLIENT_ID);
    expect(doc.application_type).toBe("native");
    expect(doc.token_endpoint_auth_method).toBe("none");
    expect(doc.redirect_uris).toEqual(expect.arrayContaining([redirectUriFor("desktop"), redirectUriFor("web")]));
    expect(redirectUriFor("desktop")).toBe(LOOPBACK_REDIRECT);
    expect(new URL(LOOPBACK_REDIRECT).hostname).toBe("127.0.0.1"); // RFC 8252 §7.3: an IP literal, not "localhost"
    expect(redirectUriFor("web")).toBe(WEB_REDIRECT);
  });

  it("no DCR call when the server advertises CIMD — even when it also has a registration endpoint and legacy is allowed", async () => {
    const w = world({ cimd: true, dcr: true });
    const started = await startAuthorization(MCP, { fetchImpl: w.fetchImpl, surface: "desktop", registry: new ClientRegistry(), allowLegacyDcr: true });
    expect(w.calls("/register")).toHaveLength(0);
    const u = new URL(started.url);
    expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(u.searchParams.get("redirect_uri")).toBe(LOOPBACK_REDIRECT);
    expect(u.searchParams.get("resource")).toBe(MCP);
    expect(u.searchParams.get("scope")).toBe("notes.read");
    expect(u.searchParams.get("code_challenge")).toBe(await pkceChallenge(started.pending.verifier));
  });

  it("without CIMD: refused unless the user gave a client id or allowed the deprecated DCR; a DCR id is bound to its issuer", async () => {
    const w = world({ cimd: false, dcr: true });
    const reg = new ClientRegistry();
    await expect(startAuthorization(MCP, { fetchImpl: w.fetchImpl, surface: "web", registry: reg })).rejects.toThrow(/neither Client ID Metadata/);
    expect(w.calls("/register")).toHaveLength(0);
    const r = await registrationFor(w.meta, { registry: reg, fetchImpl: w.fetchImpl, redirectUri: WEB_REDIRECT, allowLegacyDcr: true });
    expect(r).toEqual({ method: "dcr", clientId: "dcr-client-1" });
    expect(JSON.parse(w.calls("/register")[0].body!)).toMatchObject({ application_type: "native", token_endpoint_auth_method: "none" });
    expect(reg.get(AS)?.clientId).toBe("dcr-client-1");
    expect(reg.get("https://other.example.com")).toBeNull(); // another issuer never gets it
    // Registered once: the next sign-in reuses it.
    await registrationFor(w.meta, { registry: reg, fetchImpl: w.fetchImpl, redirectUri: WEB_REDIRECT, allowLegacyDcr: true });
    expect(w.calls("/register")).toHaveLength(1);
    const manual = new ClientRegistry();
    manual.set(AS, "my-client", "manual");
    expect(await registrationFor(w.meta, { registry: manual, fetchImpl: w.fetchImpl, redirectUri: WEB_REDIRECT })).toEqual({ method: "manual", clientId: "my-client" });
  });
});

describe("discovery", () => {
  it("follows the 401's resource_metadata, and refuses metadata for another server or an issuer that is not itself", async () => {
    const w = world();
    const d = await discover(MCP, w.fetchImpl, 'Bearer resource_metadata="https://mcp.example.com/prm", scope="notes.read"');
    expect(d.meta.issuer).toBe(AS);
    expect(w.log[0].url).toBe("https://mcp.example.com/prm");
    expect(w.log.every((l) => l.redirect === "error")).toBe(true); // never follows a redirect
    await expect(discover(MCP, world({ prmResource: "https://evil.example.com/mcp" }).fetchImpl)).rejects.toThrow(/not https:\/\/mcp\.example\.com\/mcp/);
    await expect(discover(MCP, world({ asIssuer: "https://evil.example.com" }).fetchImpl)).rejects.toThrow(/names https:\/\/evil\.example\.com/);
    await expect(discover(MCP, w.fetchImpl, 'Bearer resource_metadata="http://mcp.example.com/prm"')).rejects.toThrow(/https/);
  });
});

describe("the authorization response", () => {
  async function started(w = world()) {
    return { w, s: await startAuthorization(MCP, { fetchImpl: w.fetchImpl, surface: "desktop", registry: new ClientRegistry() }) };
  }

  it("a wrong iss is refused and the code never reaches a token endpoint", async () => {
    const { w, s } = await started();
    const q = new URLSearchParams({ code: "c", state: s.pending.state, iss: "https://evil.example.com" });
    await expect(finishAuthorization(q, s.pending, w.meta, w.fetchImpl)).rejects.toThrow(/RFC 9207/);
    const none = new URLSearchParams({ code: "c", state: s.pending.state });
    await expect(finishAuthorization(none, s.pending, w.meta, w.fetchImpl)).rejects.toThrow(/RFC 9207/);
    expect(w.calls("/token")).toHaveLength(0);
  });

  it("a mix-up (another issuer's metadata at redeem time) is refused before anything is sent", async () => {
    const { w, s } = await started();
    const evil = { ...w.meta, issuer: "https://evil.example.com", token_endpoint: "https://evil.example.com/token" };
    await expect(finishAuthorization(new URLSearchParams({ code: "c", state: s.pending.state, iss: "https://evil.example.com" }), s.pending, evil, w.fetchImpl)).rejects.toThrow(/mix-up/);
    expect(w.log.some((l) => l.url.includes("evil"))).toBe(false);
  });

  it("the right iss: the code goes with its PKCE verifier, redirect and resource; the token is bound to (issuer, resource)", async () => {
    const { w, s } = await started();
    const cred = await finishAuthorization(new URLSearchParams({ code: "c-1", state: s.pending.state, iss: AS }), s.pending, w.meta, w.fetchImpl, 1000);
    const form = new URLSearchParams(w.calls("/token")[0].body!);
    expect(Object.fromEntries(form)).toEqual({ grant_type: "authorization_code", code: "c-1", redirect_uri: LOOPBACK_REDIRECT, client_id: CLIENT_ID, code_verifier: s.pending.verifier, resource: MCP });
    expect(cred).toEqual({ issuer: AS, resource: MCP, accessToken: "at-1", refreshToken: "rt-1", expiresAt: 1000 + 3600_000 });
    const next = await refresh(cred, w.meta, CLIENT_ID, w.fetchImpl, 2000);
    expect(next.accessToken).toBe("at-2");
    expect(next.refreshToken).toBe("rt-1");
    expect(Object.fromEntries(new URLSearchParams(w.calls("/token")[1].body!))).toMatchObject({ grant_type: "refresh_token", resource: MCP });
    await expect(refresh(cred, { ...w.meta, issuer: "https://b.example.com" }, CLIENT_ID, w.fetchImpl)).rejects.toThrow(/not https:\/\/b\.example\.com/);
  });
});
