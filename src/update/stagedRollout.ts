/**
 * Staged rollout (plan W13.T1), the reference rule. The signed update
 * manifest (latest.json, verified before it is read: W11.S2/S3) may carry
 *
 *   "rollout": { "percent": 5, "salt": "v1.5.0" }   only part of the devices
 *   "halt": true                                    nobody, from now on
 *
 * Each device works out locally whether it is in: its bucket is the first
 * four bytes (big-endian) of SHA-256(salt + ":" + installId), mod 10,000,
 * and it is in when bucket < percent × 100. The install id is random, made
 * on this device and never sent anywhere; the server cannot tell who is in.
 * Raising the percent keeps every device that was already in (same salt);
 * a new salt reshuffles. The desktop shell applies the same rule before it
 * offers an update (src-tauri/src/rollout.rs); scripts/lib/rollout.mjs is
 * the release side. All three are checked against rolloutVectors.json.
 *
 * A malformed rollout (percent out of 0–100, no salt) holds the update: a
 * mistake in a manifest must never widen who gets a release.
 */

export const BUCKETS = 10_000;
export const INSTALL_ID_KEY = "lumen-install-id";

export interface Rollout {
  percent: number;
  salt: string;
}

/** Any manifest object: only `rollout` and `halt` are read. */
export type Manifestish = { rollout?: unknown; halt?: unknown; [field: string]: unknown };

export type RolloutVerdict = { admit: true } | { admit: false; reason: "halted" | "staged" | "invalid" };

/** The rollout fields of a manifest, or null when there are none (a full release). Throws on a malformed one. */
export function parseRollout(manifest: Manifestish): { rollout: Rollout | null; halt: boolean } {
  const halt = manifest.halt === true;
  if (manifest.halt !== undefined && typeof manifest.halt !== "boolean") throw new Error("halt must be true or false");
  if (manifest.rollout === undefined || manifest.rollout === null) return { rollout: null, halt };
  const r = manifest.rollout as Partial<Rollout>;
  if (typeof r !== "object" || typeof r.percent !== "number" || !Number.isFinite(r.percent) || r.percent < 0 || r.percent > 100) throw new Error("rollout.percent must be a number from 0 to 100");
  if (typeof r.salt !== "string" || !r.salt.trim() || r.salt.length > 64) throw new Error("rollout.salt must be a non-empty string of at most 64 characters");
  return { rollout: { percent: r.percent, salt: r.salt }, halt };
}

/** The threshold in buckets: 5% → 500, 0.25% → 25. */
export function threshold(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)) * 100);
}

export async function bucketOf(installId: string, salt: string, digest: (data: Uint8Array) => Promise<ArrayBuffer> = (d) => crypto.subtle.digest("SHA-256", d as BufferSource)): Promise<number> {
  const bytes = new Uint8Array(await digest(new TextEncoder().encode(`${salt}:${installId}`)));
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return n % BUCKETS;
}

/** Whether this device takes the release the manifest names. */
export async function admit(manifest: Manifestish, installId: string): Promise<RolloutVerdict> {
  let parsed: ReturnType<typeof parseRollout>;
  try {
    parsed = parseRollout(manifest);
  } catch {
    // why: a malformed rollout holds the update; it never widens who gets it
    return { admit: false, reason: "invalid" };
  }
  if (parsed.halt) return { admit: false, reason: "halted" };
  if (!parsed.rollout) return { admit: true };
  const t = threshold(parsed.rollout.percent);
  if (t >= BUCKETS) return { admit: true };
  return (await bucketOf(installId, parsed.rollout.salt)) < t ? { admit: true } : { admit: false, reason: "staged" };
}

/** 128 random bits, hex: made here, kept here, never sent. */
export function newInstallId(random: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  return [...random(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** This device's install id, made on first use. Storage that throws gives a fresh id each time (so a device without storage is in or out at random per check, never tracked). */
export function installId(storage: Pick<Storage, "getItem" | "setItem"> | null): string {
  try {
    const cur = storage?.getItem(INSTALL_ID_KEY);
    if (cur && /^[0-9a-f]{32}$/.test(cur)) return cur;
    const id = newInstallId();
    storage?.setItem(INSTALL_ID_KEY, id);
    return id;
  } catch {
    // why: storage blocked: an id for this check only
    return newInstallId();
  }
}
