/**
 * Lumen audit-log client. Fires `recordAudit(action, payload?)` from
 * mutation paths so the enterprise audit page (and any external SIEM
 * pipeline) can reconstruct who-did-what-when.
 *
 * Disabled when `VITE_AUDIT_ENDPOINT` is not set — keeps the cost
 * (network + storage) out of free-tier installs.
 */

import { log } from "./logger";

interface AuditConfig {
  endpoint: string;
  bearer: string;
}

let testOverride: AuditConfig | null = null;

/**
 * Test-only hook. Vite inlines `import.meta.env.VITE_*` at transform
 * time, so `vi.stubEnv` doesn't reach this module from a vitest test.
 * Tests call `__setAuditConfigForTesting({...})` instead, then `null`
 * to restore env-reading behaviour.
 */
export function __setAuditConfigForTesting(cfg: AuditConfig | null): void {
  testOverride = cfg;
}

/**
 * Read env on every call. Caching the values broke unit tests that
 * stub env between cases — re-reading is two property accesses,
 * negligible compared to the eventual fetch.
 */
function readConfig(): AuditConfig {
  if (testOverride) return testOverride;
  try {
    const env = (
      import.meta as ImportMeta & {
        env?: { VITE_AUDIT_ENDPOINT?: string; VITE_AUDIT_TOKEN?: string };
      }
    ).env;
    return {
      endpoint: env?.VITE_AUDIT_ENDPOINT ?? "",
      bearer: env?.VITE_AUDIT_TOKEN ?? "",
    };
  } catch {
    return { endpoint: "", bearer: "" };
  }
}

export interface AuditRow {
  user_id: string;
  org_id?: string | null;
  action: string;
  payload_json?: string;
  ts?: number;
}

/**
 * Append an audit row. `userId` is the only required arg in practice;
 * everything else is optional metadata. The call is fire-and-forget —
 * a network failure logs but never throws into the calling path.
 */
export function recordAudit(
  userId: string,
  action: string,
  opts: { orgId?: string | null; payload?: unknown } = {},
): void {
  const { endpoint, bearer } = readConfig();
  if (!endpoint) return; // audit disabled; no-op

  const body: AuditRow = {
    user_id: userId,
    org_id: opts.orgId ?? null,
    action,
    payload_json: opts.payload === undefined ? undefined : JSON.stringify(opts.payload),
    ts: Date.now(),
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  // Use fetch with keepalive so the row survives an unload race.
  fetch(`${endpoint.replace(/\/+$/, "")}/audit`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    keepalive: true,
  }).catch((err) => {
    log.warn("audit submit failed", err);
  });
}

/** Read recent audit rows for an org (admin UI). */
export async function listAudit(opts: {
  orgId: string;
  limit?: number;
  before?: number;
  action?: string;
}): Promise<AuditRow[]> {
  const { endpoint, bearer } = readConfig();
  if (!endpoint) return [];
  const params = new URLSearchParams({ orgId: opts.orgId });
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.before) params.set("before", String(opts.before));
  if (opts.action) params.set("action", opts.action);
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(
    `${endpoint.replace(/\/+$/, "")}/audit?${params.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`audit list failed: ${res.status}`);
  const json = (await res.json()) as { rows: AuditRow[] };
  return json.rows;
}
