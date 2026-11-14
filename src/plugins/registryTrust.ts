/**
 * Trust state of a remote plugin-registry entry (plan W10.B1, W10.B2).
 *
 * The gallery used to treat every registry entry as verified
 * (`verified ?? true`) and to "install" it by waiting 400 ms and showing
 * a success toast, without downloading or running anything. Both were
 * claims the code could not back.
 *
 * The rules now:
 *   • An entry's own `verified` field is ignored. A registry can say
 *     anything about itself; only a signature check counts.
 *   • An entry is "verified" only when it carries a `signature` and a
 *     `signedBy`, its bundle downloads, and `verifyPluginSignature`
 *     returns `true` for those bytes against a pinned trust root.
 *   • A remote entry of this legacy registry.json is not installable from
 *     the gallery: it names a bare script, not a sandboxed plugin with a
 *     manifest. The signed install path (W10.B3: Ed25519 over index.json,
 *     sha256 of manifest and code → QuickJS) is src/plugins/install.ts and
 *     takes registries in the index.json format. The gallery shows
 *     "Not available yet" instead of a fake success.
 */

import { verifyPluginSignature } from "./signing";

export interface RegistryEntryTrustInput {
  id: string;
  url?: string;
  signature?: string;
  signedBy?: string;
  /** Self-declared by the registry. Ignored on purpose. */
  verified?: boolean;
}

export type RegistryTrust = "verified" | "unverified";

/** True when the entry carries everything a signature check needs. */
export function hasSignedBundle(entry: RegistryEntryTrustInput): boolean {
  return Boolean(entry.url && entry.signature && entry.signedBy);
}

/**
 * Decide whether the gallery may show the "verified" badge for an entry.
 * `fetchBytes` downloads the bundle; it is only called for signed entries,
 * so an unsigned registry causes no network traffic here.
 */
export async function checkRegistryEntry(
  entry: RegistryEntryTrustInput,
  fetchBytes: (url: string) => Promise<Uint8Array>,
): Promise<RegistryTrust> {
  if (!hasSignedBundle(entry)) return "unverified";
  try {
    const bytes = await fetchBytes(entry.url as string);
    const result = await verifyPluginSignature(bytes, {
      signature: entry.signature,
      signedBy: entry.signedBy,
    });
    return result === true ? "verified" : "unverified";
  } catch {
    return "unverified";
  }
}

/**
 * Whether the gallery may install a legacy registry.json entry: no. These
 * entries are bare scripts with no manifest or permissions, so the signed
 * path (install.ts) cannot take them, and the gallery must not pretend to
 * install something it never downloaded or ran.
 */
export function isRemoteInstallable(_entry: RegistryEntryTrustInput): boolean {
  return false;
}
