// @vitest-environment node
/**
 * Audit worker: identity and scope come from the caller's own token, never
 * from client-sent user_id / org_id / orgId.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { type Env } from "../../edge-workers/audit/worker";
import { SSO_TOKEN_ISS, SSO_TOKEN_AUD } from "../../edge-workers/shared/ssoToken";

const SECRET = "sso-secret";

function b64url(s: string | Uint8Array): string {
  const bytes = typeof s === "string" ? new TextEncoder().encode(s) : s;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function ssoToken(claims: Record<string, unknown>, secret = SECRET): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: SSO_TOKEN_ISS, aud: SSO_TOKEN_AUD, iat: now, exp: now + 300, ...claims }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

function makeEnv(extra: Partial<Env> = {}) {
  const inserts: unknown[][] = [];
  const queries: unknown[][] = [];
  const env: Env = {
    SSO_TOKEN_SECRET: SECRET,
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    ...extra,
    DB: {
      prepare: (sql: string) => {
        let binds: unknown[] = [];
        const stmt = {
          bind: (...v: unknown[]) => ((binds = v), stmt),
          first: async () => null,
          all: async <T,>() => {
            queries.push(binds);
            return { results: [] as T[] };
          },
          run: async () => {
            if (/INSERT/.test(sql)) inserts.push(binds);
            return { success: true };
          },
        };
        return stmt;
      },
    },
  };
  return { env, inserts, queries };
}

const post = (token: string | null, body: unknown) =>
  new Request("https://audit.test/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (token: string, qs = "") =>
  new Request(`https://audit.test/audit${qs}`, { headers: { Authorization: `Bearer ${token}` } });

afterEach(() => vi.unstubAllGlobals());

describe("audit worker auth", () => {
  it("records the SSO caller and their org, ignoring client-sent ids", async () => {
    const { env, inserts } = makeEnv();
    const tok = await ssoToken({ sub: "user_01", org: "org_acme" });
    const res = await worker.fetch(post(tok, { user_id: "victim", org_id: "org_other", action: "doc.publish" }), env);
    expect(res.status).toBe(200);
    expect(inserts[0].slice(0, 3)).toEqual(["user_01", "org_acme", "doc.publish"]);
  });

  it("scopes a Supabase user to their own id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "sb-1" }), { status: 200 })));
    const { env, inserts } = makeEnv();
    await worker.fetch(post("supabase-jwt", { user_id: "x", org_id: "org_acme", action: "sync.cloud" }), env);
    expect(inserts[0].slice(0, 2)).toEqual(["sb-1", "sb-1"]);
  });

  it("rejects missing, forged and expired tokens", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    const { env, inserts } = makeEnv();
    expect((await worker.fetch(post(null, { action: "a" }), env)).status).toBe(401);
    expect((await worker.fetch(post(await ssoToken({ sub: "u" }, "wrong"), { action: "a" }), env)).status).toBe(401);
    expect((await worker.fetch(post(await ssoToken({ sub: "u", exp: 1 }), { action: "a" }), env)).status).toBe(401);
    // A former shared-secret style token is just an invalid Supabase JWT now.
    expect((await worker.fetch(post("old-shared-secret", { user_id: "u", action: "a" }), env)).status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("lists only the caller's scope and forbids other orgs", async () => {
    const { env, queries } = makeEnv();
    const tok = await ssoToken({ sub: "user_01", org: "org_acme" });
    expect((await worker.fetch(get(tok), env)).status).toBe(200);
    expect(queries[0][0]).toBe("org_acme");
    expect((await worker.fetch(get(tok, "?orgId=org_acme"), env)).status).toBe(200);
    expect((await worker.fetch(get(tok, "?orgId=org_other"), env)).status).toBe(403);
  });

  it("lets a trusted back-end with AUDIT_SERVICE_SECRET name the user and org", async () => {
    const { env, inserts, queries } = makeEnv({ AUDIT_SERVICE_SECRET: "svc-secret-123" });
    await worker.fetch(post("svc-secret-123", { user_id: "u9", org_id: "org_9", action: "admin.x" }), env);
    expect(inserts[0].slice(0, 2)).toEqual(["u9", "org_9"]);
    await worker.fetch(get("svc-secret-123", "?orgId=org_9"), env);
    expect(queries[0][0]).toBe("org_9");
  });
});
