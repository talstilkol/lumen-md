/**
 * The API surface one plugin gets (W13.L2): the methods of its target API
 * version, the version the sandbox reports as `lumen.apiVersion`, the
 * compatibility warning and the deprecation warnings. Used by the sandbox
 * (what exists inside) and by the host (its second check), so both agree.
 */
import { METHOD_CAPABILITY } from "../runtime/capabilities";
import type { PluginManifest } from "../runtime/manifest";
import { checkApiCompat, deprecationOf, deprecationWarning, methodsForTarget, PluginApiVersionError } from "./version";

export interface SandboxSurface {
  methods: string[];
  apiVersion: string;
  warnings: string[];
  /** Deprecated methods in this surface → the warning the first call logs. */
  deprecated: Record<string, string>;
}

/** Throws PluginApiVersionError when this Lumen cannot run the plugin. */
export function sandboxSurface(manifest: Pick<PluginManifest, "id" | "minApiVersion" | "targetApiVersion">): SandboxSurface {
  const compat = checkApiCompat(manifest);
  if (!compat.ok) throw new PluginApiVersionError(compat);
  const methods = methodsForTarget(Object.keys(METHOD_CAPABILITY), compat.mode === "compat" ? compat.target : compat.apiVersion);
  const deprecated: Record<string, string> = {};
  for (const m of methods) {
    const d = deprecationOf(m);
    if (d) deprecated[m] = deprecationWarning(manifest.id, d);
  }
  return { methods, apiVersion: compat.apiVersion, warnings: compat.warnings, deprecated };
}
