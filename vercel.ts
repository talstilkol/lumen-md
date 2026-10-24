/**
 * Vercel project configuration (plan 0.20).
 *
 * Vercel runs this file at build time, with the project's environment, in
 * place of a static vercel.json. It loads deploy/vercel.base.json, whose
 * security headers are rendered from security/policy.json and checked by
 * `npm run headers`, and fills the app policy's connect-src placeholder with
 * the origins of the endpoint workers this deployment is built with. A static
 * vercel.json cannot know them, so its header blocked those workers while the
 * page's own <meta> policy allowed them.
 *
 * Self-contained on purpose: no imports beyond Node's, so it runs however
 * Vercel loads it. The endpoint rules mirror src/build/cspEndpoints.ts, and
 * src/__tests__/vercelConfig.test.ts keeps the two in step.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Same list and rules as ENDPOINT_ENV_VARS / endpointOrigins in src/build/cspEndpoints.ts. */
export const ENDPOINT_ENV_VARS = [
  "VITE_WORKOS_ENDPOINT",
  "VITE_BILLING_ENDPOINT",
  "VITE_ENTITLEMENT_ENDPOINT",
  "VITE_PUBLISH_ENDPOINT",
  "VITE_RESEARCH_ENDPOINT",
  "VITE_AUDIT_ENDPOINT",
  "VITE_MARKETPLACE_URL",
  "VITE_LANGUAGETOOL_URL",
  "VITE_SUPABASE_URL",
];
export const EXTRA_CONNECT_ENV_VAR = "VITE_CSP_CONNECT_EXTRA";
/** The marker security/policy.json puts in the app policy for this host. */
export const PLACEHOLDER = "__CSP_CONNECT_EXTRA__";

type Env = Record<string, string | undefined>;
interface HeaderEntry {
  source: string;
  headers: { key: string; value: string }[];
}
interface VercelConfig {
  headers?: HeaderEntry[];
  [key: string]: unknown;
}

export function endpointOrigins(env: Env): string[] {
  const out = new Set<string>();
  for (const key of ENDPOINT_ENV_VARS) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (/(^|\.)example\.(com|org|net)$/i.test(url.hostname) || /placeholder|your-/i.test(raw)) continue;
    out.add(url.origin);
  }
  for (const raw of (env[EXTRA_CONNECT_ENV_VAR] ?? "").split(/[\s,]+/)) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (["https:", "http:", "wss:", "ws:"].includes(u.protocol)) out.add(u.origin);
    } catch {
      /* not an origin: ignore */
    }
  }
  return [...out].sort();
}

/** The base config with the placeholder replaced by `origins` (or removed when there are none). */
export function vercelConfig(base: VercelConfig, origins: readonly string[]): VercelConfig {
  const fill = (value: string) =>
    value
      .split(";")
      .map((part) =>
        part.includes(PLACEHOLDER)
          ? part
              .split(/\s+/)
              .flatMap((t) => (t === PLACEHOLDER ? origins.filter((o) => !part.split(/\s+/).includes(o)) : t ? [t] : []))
              .join(" ")
          : part.trim(),
      )
      .join("; ");
  const { $schema: _schema, ...rest } = base;
  return {
    ...rest,
    headers: (base.headers ?? []).map((entry) => ({
      ...entry,
      headers: entry.headers.map((h) => (h.value.includes(PLACEHOLDER) ? { ...h, value: fill(h.value) } : h)),
    })),
  };
}

const base = JSON.parse(readFileSync(join(process.cwd(), "deploy/vercel.base.json"), "utf8")) as VercelConfig;
export const config = vercelConfig(base, endpointOrigins(process.env));
