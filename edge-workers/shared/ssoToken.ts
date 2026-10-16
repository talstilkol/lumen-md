/**
 * Verification of the short-lived HS256 identity token minted by the SSO
 * worker (`GET /api/sso/token`, edge-workers/auth). Lumen's own workers
 * (billing, audit) accept it as a bearer token to identify WorkOS users;
 * Supabase users present their Supabase JWT instead.
 */

/** Issuer / audience of the tokens minted by the SSO worker. */
export const SSO_TOKEN_ISS = "lumen-sso";
export const SSO_TOKEN_AUD = "lumen-billing";

export interface SsoClaims {
  /** WorkOS user id (same as the client's `user.id`). */
  sub: string;
  /** WorkOS organization id, when the session came from an org login. */
  org?: string;
  /** WorkOS role slug in that organization (e.g. "admin"), when configured. */
  role?: string;
}

const te = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Returns null for anything that isn't one of our tokens (so the caller
 * can fall back to Supabase) and throws for one that claims to be ours but
 * fails verification (bad signature / audience / expiry / subject).
 */
export async function verifySsoToken(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<SsoClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let head: { alg?: unknown };
  let payload: { iss?: unknown; aud?: unknown; sub?: unknown; org?: unknown; role?: unknown; exp?: unknown };
  try {
    head = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (head.alg !== "HS256" || payload.iss !== SSO_TOKEN_ISS) return null;
  const key = await crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(parts[2]), te.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("Invalid token");
  if (payload.aud !== SSO_TOKEN_AUD) throw new Error("Invalid token");
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) throw new Error("Token expired");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("No user id in token");
  return {
    sub: payload.sub,
    ...(typeof payload.org === "string" && payload.org ? { org: payload.org } : {}),
    ...(typeof payload.role === "string" && payload.role ? { role: payload.role } : {}),
  };
}
