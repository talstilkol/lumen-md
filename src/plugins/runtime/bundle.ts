/**
 * The plugin bundle (plan 11.2.4): one JSON file, `<id>-<version>.lumenplugin.json`,
 *
 *   { "format": "lumen-plugin/1", "manifest": "<lumen-plugin.json text>", "main": "<main.js text>",
 *     "signature"?: "<base64 Ed25519>", "signedBy"?: "<key fingerprint>" }
 *
 * The signed bytes are the UTF-8 of `JSON.stringify([manifest, main])` —
 * the exact texts, so nothing about JSON formatting can change what was
 * signed. The registry pins each bundle by the sha256 of the same bytes.
 */
import { parseManifest, type PluginManifest } from "./manifest";

export const BUNDLE_FORMAT = "lumen-plugin/1";
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

export interface PluginBundle {
  manifestText: string;
  manifest: PluginManifest;
  main: string;
  signature?: string;
  signedBy?: string;
}

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

/** The bytes that are signed and pinned. */
export function bundlePayload(manifestText: string, main: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([manifestText, main])) as Uint8Array<ArrayBuffer>;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseBundle(text: string): PluginBundle {
  if (text.length > MAX_BUNDLE_BYTES) throw new BundleError(`a plugin bundle is limited to ${MAX_BUNDLE_BYTES / 1024 / 1024} MB`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BundleError("not a Lumen plugin bundle (invalid JSON)");
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.format !== BUNDLE_FORMAT) throw new BundleError(`not a Lumen plugin bundle (format must be "${BUNDLE_FORMAT}")`);
  if (typeof o.manifest !== "string" || typeof o.main !== "string") throw new BundleError("bundle: manifest and main must be strings");
  const manifest = parseManifest(o.manifest);
  const sig = typeof o.signature === "string" ? o.signature : undefined;
  const by = typeof o.signedBy === "string" ? o.signedBy : undefined;
  if ((sig === undefined) !== (by === undefined)) throw new BundleError("bundle: signature and signedBy go together");
  return { manifestText: o.manifest, manifest, main: o.main, ...(sig ? { signature: sig, signedBy: by } : {}) };
}

export function serializeBundle(b: { manifestText: string; main: string; signature?: string; signedBy?: string }): string {
  return JSON.stringify({ format: BUNDLE_FORMAT, manifest: b.manifestText, main: b.main, ...(b.signature ? { signature: b.signature, signedBy: b.signedBy } : {}) }, null, 2) + "\n";
}
