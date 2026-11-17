/**
 * The plugin API version and its compatibility rules (plan W13.L1, W13.L2).
 *
 * The API is semver'd apart from the app: `PLUGIN_API_VERSION` names the
 * surface in lumen-plugin.d.ts, and scripts/plugin-api-report.mjs fails when
 * the surface changed without the matching bump.
 *
 * A manifest may say which API it needs and which it was built against:
 *   - `minApiVersion`    below it the plugin does not load, with a clear message;
 *   - `targetApiVersion` what the author tested on (default 1.0.0).
 * Lumen runs the current major and the one before it (N and N-1). A plugin
 * that targets an older version runs in compatibility mode: the sandbox
 * gives it the surface of its target (compat.ts) and warns once.
 *
 * Kept free of imports from the sandbox so the report script and the
 * install screen can read it without QuickJS.
 */

export const PLUGIN_API_VERSION = "1.1.0";

/** What a manifest that names no target is taken to target: the first public API. */
export const DEFAULT_TARGET_API = "1.0.0";

/** A method that is on its way out: it still works, warns once per plugin, and goes in `removeIn`. */
export interface Deprecation {
  /** `<namespace>.<method>`, as in METHOD_CAPABILITY. */
  method: string;
  since: string;
  removeIn: string;
  /** What to call instead. */
  use: string;
}

/** Mirrors the `@deprecated` tags of lumen-plugin.d.ts (a test keeps the two equal). */
export const DEPRECATIONS: readonly Deprecation[] = [{ method: "document.setText", since: "1.1.0", removeIn: "2.0.0", use: "document.applyEdits" }];

/** Methods by the API version that added them; methods not listed are 1.0.0. Mirrors `@since` in the .d.ts. */
export const METHOD_SINCE: Readonly<Record<string, string>> = { "document.applyEdits": "1.1.0" };

export type Semver = [number, number, number];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(v: string): Semver | null {
  const m = SEMVER_RE.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0 or 1; prerelease tags are ignored. Invalid input sorts first. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a) ?? [-1, 0, 0];
  const pb = parseSemver(b) ?? [-1, 0, 0];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/** The methods a plugin that targets `target` sees: those added at or before it (on a newer major, all of the current ones). */
export function methodsForTarget(all: readonly string[], target: string, current = PLUGIN_API_VERSION): string[] {
  const t = parseSemver(target);
  const c = parseSemver(current);
  if (!t || !c || t[0] !== c[0] || compareSemver(target, current) >= 0) return [...all];
  return all.filter((m) => compareSemver(METHOD_SINCE[m] ?? DEFAULT_TARGET_API, target) <= 0);
}

export function deprecationOf(method: string, current = PLUGIN_API_VERSION): Deprecation | null {
  return DEPRECATIONS.find((d) => d.method === method && compareSemver(current, d.since) >= 0) ?? null;
}

/** The once-per-plugin warning text for a deprecated call (English: it goes to the plugin's console, read by developers). */
export function deprecationWarning(pluginId: string, d: Deprecation): string {
  return `plugin ${pluginId}: lumen.${d.method} is deprecated since plugin API ${d.since} and will be removed in ${d.removeIn}; use lumen.${d.use}`;
}

export type ApiCompat =
  | { ok: true; mode: "current"; apiVersion: string; warnings: [] }
  | { ok: true; mode: "compat"; apiVersion: string; target: string; warnings: string[] }
  | { ok: false; reason: "below-min" | "newer-major" | "unsupported-major" | "invalid"; message: string; need: string; have: string };

/**
 * Can this Lumen run a plugin that needs `minApiVersion` and targets `targetApiVersion`?
 * `apiVersion` is what the sandbox will speak to it.
 */
export function checkApiCompat(manifest: { id: string; minApiVersion?: string; targetApiVersion?: string }, current = PLUGIN_API_VERSION): ApiCompat {
  const have = current;
  const target = manifest.targetApiVersion ?? manifest.minApiVersion ?? DEFAULT_TARGET_API;
  const min = manifest.minApiVersion ?? DEFAULT_TARGET_API;
  const pc = parseSemver(current);
  const pt = parseSemver(target);
  const pm = parseSemver(min);
  if (!pc || !pt || !pm) return { ok: false, reason: "invalid", need: target, have, message: `plugin ${manifest.id}: its API versions are not semantic versions` };
  if (compareSemver(min, current) > 0) {
    return { ok: false, reason: "below-min", need: min, have, message: `plugin ${manifest.id} needs plugin API ${min} or newer; this Lumen has ${current}. Update Lumen to use it.` };
  }
  if (pt[0] > pc[0]) {
    return { ok: false, reason: "newer-major", need: target, have, message: `plugin ${manifest.id} was built for plugin API ${target}, a newer major version than this Lumen's ${current}. Update Lumen to use it.` };
  }
  if (pt[0] < pc[0] - 1) {
    return { ok: false, reason: "unsupported-major", need: target, have, message: `plugin ${manifest.id} was built for plugin API ${target}; Lumen ${current} runs plugins for API ${pc[0] - 1}.x and ${pc[0]}.x only. Ask its author for an update.` };
  }
  if (compareSemver(target, current) < 0) {
    return {
      ok: true,
      mode: "compat",
      apiVersion: pt[0] === pc[0] ? `${pt[0]}.${pt[1]}.${pt[2]}` : current,
      target,
      warnings: [`plugin ${manifest.id} targets plugin API ${target}; Lumen ${current} runs it in compatibility mode`],
    };
  }
  return { ok: true, mode: "current", apiVersion: current, warnings: [] };
}

/** A load refused for its API version (the install screen and the plugin list show `message`). */
export class PluginApiVersionError extends Error {
  constructor(readonly compat: Extract<ApiCompat, { ok: false }>) {
    super(compat.message);
    this.name = "PluginApiVersionError";
  }
}
