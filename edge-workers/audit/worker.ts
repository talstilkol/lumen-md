/**
 * Lumen audit-log edge worker (ε.2).
 *
 * Two endpoints, both authenticated with the CALLER'S OWN identity token:
 * a Supabase JWT, or the SSO worker's short-lived HS256 token (WorkOS
 * users). The worker derives who the caller is and which scope they belong
 * to from that token — the client can neither choose the user an event is
 * recorded for nor read another organization's log.
 *
 *   POST /audit  — append an audit row for the caller. Body: { action,
 *                  payload_json? }. user_id = the caller; org_id = the
 *                  caller's scope (SSO organization, else their user id).
 *                  Client-sent user_id / org_id are ignored.
 *   GET  /audit  — list rows in the caller's scope (paginated, filterable:
 *                  limit, before, action). An `orgId` param, if sent, must
 *                  equal the caller's scope (403 otherwise).
 *
 * Trusted back-ends may instead authenticate with AUDIT_SERVICE_SECRET
 * (never shipped to browsers) and then supply user_id / org_id / orgId.
 *
 * Storage: Cloudflare D1 (`audit_events`). Schema migration in
 *   `edge-workers/audit/schema.sql` and mirrored in `docker/postgres-init.sql`
 *   for the on-prem deployment.
 *
 * Deploy:
 *   cd edge-workers/audit && wrangler deploy
 *   wrangler secret put SUPABASE_URL / SUPABASE_ANON_KEY   (Supabase auth)
 *   wrangler secret put SSO_TOKEN_SECRET                    (= the SSO worker's BILLING_TOKEN_SECRET)
 *   wrangler secret put AUDIT_SERVICE_SECRET                (optional, server-to-server only)
 */

import { verifySsoToken } from "../shared/ssoToken";

export interface Env {
  DB: D1Database;
  SUPABASE_URL?: string;
  /** Any key PostgREST/GoTrue accepts as `apikey` (anon is enough). */
  SUPABASE_ANON_KEY?: string;
  SSO_TOKEN_SECRET?: string;
  AUDIT_SERVICE_SECRET?: string;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

interface AuditRow {
  user_id: string;
  org_id?: string | null;
  action: string;
  payload_json?: string;
  ip?: string;
  user_agent?: string;
  ts: number;
}

export type Caller =
  | { kind: "user"; userId: string; scope: string }
  | { kind: "service" };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Identify the caller from `Authorization: Bearer …`, or null when the
 * token is missing / invalid.
 */
export async function identifyCaller(req: Request, env: Env): Promise<Caller | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  if (env.AUDIT_SERVICE_SECRET && timingSafeEqual(token, env.AUDIT_SERVICE_SECRET)) {
    return { kind: "service" };
  }
  if (env.SSO_TOKEN_SECRET) {
    try {
      const sso = await verifySsoToken(token, env.SSO_TOKEN_SECRET);
      if (sso) return { kind: "user", userId: sso.sub, scope: sso.org ?? sso.sub };
    } catch {
      return null; // claims to be ours but fails verification
    }
  }
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: unknown };
    if (typeof u.id === "string" && u.id) return { kind: "user", userId: u.id, scope: u.id };
  }
  return null;
}

/** Append a single audit row. */
async function appendAudit(env: Env, row: AuditRow): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO audit_events
         (user_id, org_id, action, payload_json, ip, user_agent, ts)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      row.user_id,
      row.org_id ?? null,
      row.action,
      row.payload_json ?? null,
      row.ip ?? null,
      row.user_agent ?? null,
      row.ts,
    )
    .run();
}

/** List rows for an org, newest first. */
async function listAudit(
  env: Env,
  opts: { orgId: string; before?: number; action?: string; limit: number },
): Promise<AuditRow[]> {
  const where: string[] = ["org_id = ?1"];
  const binds: unknown[] = [opts.orgId];
  if (opts.before) {
    where.push(`ts < ?${binds.length + 1}`);
    binds.push(opts.before);
  }
  if (opts.action) {
    where.push(`action = ?${binds.length + 1}`);
    binds.push(opts.action);
  }
  binds.push(opts.limit);
  const sql = `SELECT user_id, org_id, action, payload_json, ip, user_agent, ts
               FROM audit_events
               WHERE ${where.join(" AND ")}
               ORDER BY ts DESC
               LIMIT ?${binds.length}`;
  const result = await env.DB.prepare(sql).bind(...binds).all<AuditRow>();
  return result.results;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response("ok", { headers: CORS });
    }
    if (url.pathname !== "/audit") {
      return new Response("Not found", { status: 404, headers: CORS });
    }
    const caller = await identifyCaller(req, env);
    if (!caller) {
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }

    if (req.method === "POST") {
      try {
        const body = (await req.json()) as Partial<AuditRow>;
        const userId = caller.kind === "user" ? caller.userId : body.user_id;
        const orgId = caller.kind === "user" ? caller.scope : (body.org_id ?? null);
        if (!userId || !body.action) {
          return new Response("user_id and action required", {
            status: 400,
            headers: CORS,
          });
        }
        const ip =
          req.headers.get("cf-connecting-ip") ??
          req.headers.get("x-forwarded-for") ??
          undefined;
        const userAgent = req.headers.get("user-agent") ?? undefined;
        await appendAudit(env, {
          user_id: userId,
          org_id: orgId,
          action: body.action,
          payload_json: body.payload_json,
          ip,
          user_agent: userAgent,
          ts: Date.now(),
        });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(`Bad request: ${(err as Error).message}`, {
          status: 400,
          headers: CORS,
        });
      }
    }

    if (req.method === "GET") {
      const requested = url.searchParams.get("orgId");
      let orgId: string;
      if (caller.kind === "user") {
        // Only ever the caller's own scope.
        if (requested && requested !== caller.scope) {
          return new Response("Forbidden", { status: 403, headers: CORS });
        }
        orgId = caller.scope;
      } else {
        if (!requested) {
          return new Response("orgId required", { status: 400, headers: CORS });
        }
        orgId = requested;
      }
      const limit = Math.min(
        500,
        Math.max(1, Number(url.searchParams.get("limit") ?? 100)),
      );
      const before = url.searchParams.get("before")
        ? Number(url.searchParams.get("before"))
        : undefined;
      const action = url.searchParams.get("action") ?? undefined;
      const rows = await listAudit(env, { orgId, before, action, limit });
      return new Response(JSON.stringify({ rows, count: rows.length }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: CORS });
  },
};
