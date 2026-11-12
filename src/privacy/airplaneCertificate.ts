/**
 * Airplane-mode certificate (plan W5.9): "from X to Y, airplane mode was on,
 * N attempts, N blocked, 0 left the device" — with every attempt of the
 * window listed, as canonical JSON (keys sorted, no whitespace: the same
 * certificate always gives the same bytes) and its SHA-256.
 *
 * Signing: the plan signs it with the signed privacy report's mechanism
 * (W2.24: a minisign Ed25519 key of this device). That work is not on this
 * branch's base yet, so `sealCertificate` takes the signer as a parameter;
 * without one the certificate carries its digest only, which proves the file
 * was not changed after it was made only to someone who saw the digest then.
 * When W2.24 is merged, pass its signer here (one line in NetworkMonitor).
 */
import type { EgressAttempt } from "./airplane";

export const CERTIFICATE_FORMAT = "lumen-airplane-certificate/1";

export interface CertificateSummary {
  attempts: number;
  blocked: number;
  /** blob:, data: and loopback (a local model). */
  local: number;
  /** The app's own files, answered from a cache only. */
  cacheOnly: number;
  /** Attempts that reached the network. The claim is that this is 0. */
  left: number;
}

export interface AirplaneCertificate {
  format: typeof CERTIFICATE_FORMAT;
  app: string;
  from: number;
  to: number;
  summary: CertificateSummary;
  attempts: EgressAttempt[];
}

export interface SealedCertificate {
  text: string;
  sha256: string;
  /** A detached signature, when a signer was given. */
  signature?: string;
}

/** JSON with object keys sorted at every level and no whitespace (the same as W2.24's report). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Did this attempt reach the network? Blocked attempts and CSP refusals did
 * not; local and cache-only ones stay on the device; a resource the browser
 * served from a cache transferred 0 bytes.
 */
export function reachedNetwork(a: EgressAttempt): boolean {
  if (a.decision !== "allowed" || a.kind === "csp") return false;
  if (a.kind === "resource") return (a.transferSize ?? 0) > 0;
  return true;
}

export function summarize(attempts: readonly EgressAttempt[]): CertificateSummary {
  return {
    attempts: attempts.length,
    blocked: attempts.filter((a) => a.decision === "blocked").length,
    local: attempts.filter((a) => a.decision === "local").length,
    cacheOnly: attempts.filter((a) => a.decision === "cache-only").length,
    left: attempts.filter(reachedNetwork).length,
  };
}

export function appVersion(): string {
  const v = import.meta.env?.VITE_LUMEN_VERSION as string | undefined;
  return v?.trim() || "dev";
}

/** The certificate of the window [from, to]: every attempt in it. */
export function buildCertificate(all: readonly EgressAttempt[], from: number, to: number, app: string = appVersion()): AirplaneCertificate {
  const attempts = all.filter((a) => a.ts >= from && a.ts <= to);
  return { format: CERTIFICATE_FORMAT, app, from, to, summary: summarize(attempts), attempts };
}

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sealCertificate(cert: AirplaneCertificate, sign?: (text: string) => Promise<string>): Promise<SealedCertificate> {
  const text = canonicalJson(cert);
  const sealed: SealedCertificate = { text, sha256: await sha256Hex(text) };
  if (sign) sealed.signature = await sign(text);
  return sealed;
}

/** Check a certificate's text against its digest, and that its summary matches its attempts. */
export async function verifyCertificate(sealed: SealedCertificate): Promise<{ ok: boolean; cert: AirplaneCertificate | null }> {
  let cert: AirplaneCertificate | null = null;
  try {
    cert = JSON.parse(sealed.text) as AirplaneCertificate;
  } catch {
    return { ok: false, cert: null };
  }
  const ok =
    cert?.format === CERTIFICATE_FORMAT &&
    (await sha256Hex(sealed.text)) === sealed.sha256 &&
    canonicalJson(cert) === sealed.text &&
    canonicalJson(summarize(cert.attempts.filter((a) => a.ts >= cert!.from && a.ts <= cert!.to))) === canonicalJson(cert.summary);
  return { ok, cert };
}
