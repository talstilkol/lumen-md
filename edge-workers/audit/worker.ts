/**
 * Lumen audit-log edge worker (ε.2).
 *
 * Two endpoints:
 *   POST /audit       — append an audit row.
 *                       Body: { action, payload?, userId, orgId? }.
 *                       Authenticated via Bearer token (matches the auth
 *                       provider's JWT for that user).
 *
 *   GET  /audit       — list rows for the caller's org (paginated +
 *                       filterable). Query params: limit, before, action.
 *
 * Storage: Cloudflare D1 (`audit_events`). Schema migration in
 *   `edge-workers/audit/schema.sql` and mirrored in `docker/postgres-init.sql`
 *   for the on-prem deployment.
 *
 * Deploy:
 *   cd edge-workers/audit && wrangler deploy
 */

interface Env {
  DB: D1Database;
  AUDIT_BEARER_SECRET: string;
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

/** Validate the caller's bearer token (cheap stand-in until WorkOS lands). */
function authorize(req: Request, env: Env): boolean {
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const expected = `Bearer ${env.AUDIT_BEARER_SECRET}`;
  return auth === expected;
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
    if (!authorize(req, env)) {
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }

    if (req.method === "POST") {
      try {
        const body = await req.json<Partial<AuditRow>>();
        if (!body.user_id || !body.action) {
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
          user_id: body.user_id,
          org_id: body.org_id ?? null,
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
      const orgId = url.searchParams.get("orgId");
      if (!orgId) {
        return new Response("orgId required", { status: 400, headers: CORS });
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
