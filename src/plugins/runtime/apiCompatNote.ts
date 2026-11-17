/**
 * What the install screen and the gallery say about a plugin's API version
 * (W13.L2): nothing when it targets this Lumen's API, a note when it runs in
 * compatibility mode, and the reason when this Lumen cannot run it.
 */
import { t } from "../../i18n";
import { checkApiCompat, PLUGIN_API_VERSION } from "../api/version";
import type { PluginManifest } from "./manifest";

export interface ApiCompatNote {
  tone: "info" | "error";
  text: string;
  /** False when the plugin cannot be installed here. */
  installable: boolean;
}

export function apiCompatNote(manifest: Pick<PluginManifest, "id" | "minApiVersion" | "targetApiVersion">, current = PLUGIN_API_VERSION): ApiCompatNote | null {
  const c = checkApiCompat(manifest, current);
  if (c.ok) return c.mode === "compat" ? { tone: "info", installable: true, text: t("pluginTrust.api.compat", { target: c.target, current }) } : null;
  const key = c.reason === "below-min" ? "pluginTrust.api.belowMin" : c.reason === "newer-major" ? "pluginTrust.api.newerMajor" : c.reason === "unsupported-major" ? "pluginTrust.api.unsupported" : "pluginTrust.api.invalid";
  return { tone: "error", installable: false, text: t(key, { need: c.need, have: c.have }) };
}
