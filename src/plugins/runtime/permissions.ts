/**
 * Capabilities in plain language (plan W1.20): what the install screen
 * says each permission lets a plugin do.
 */
import "./trustStrings";
import { t } from "../../i18n";
import { isNetworkCapability, networkOrigin } from "./manifest";
import type { ScanFinding } from "./scan";

/** Permissions that reach beyond the plugin itself: the user's notes, the clipboard, the network. */
const SENSITIVE = new Set(["document:write", "vault:read", "vault:write", "clipboard:write"]);

export function isSensitive(cap: string): boolean {
  return SENSITIVE.has(cap) || isNetworkCapability(cap);
}

/** "Read the note that is open", "Connect to https://example.com — and nowhere else", … */
export function describeCapability(cap: string): string {
  if (isNetworkCapability(cap)) return t("pluginTrust.cap.network", { origin: networkOrigin(cap) ?? cap.slice("network:".length) });
  return t(`pluginTrust.cap.${cap.replace(/:/g, "-")}`);
}

/** The scan findings as short notes for the card. */
export function describeFindings(findings: readonly ScanFinding[]): string {
  return [...new Set(findings.map((f) => t(`pluginTrust.rule.${f.rule}`)))].join(" · ");
}

/** A prefilled GitHub issue for a plugin version. */
export function reportUrl(id: string, version: string): string {
  const title = `Plugin report: ${id} ${version}`;
  const body = `Plugin: ${id}\nVersion: ${version}\n\nWhat happened:\n`;
  return `https://github.com/talstilkol/lumen-md/issues/new?labels=plugin-report&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
