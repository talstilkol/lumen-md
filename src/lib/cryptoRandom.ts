/**
 * Cryptographically-secure random helpers.
 *
 * Replaces Math.random() in places where collisions matter (peer IDs, asset
 * names, room IDs). Math.random() is not cryptographically strong; with enough
 * peers or rapid pastes we can hit collisions in CRDT or OPFS.
 */

/** Hex string of `bytes` random bytes. Default 8 → 16-char id. */
export function randomId(bytes = 8): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    out += arr[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Uniform integer in [0, maxExclusive). Avoids Math.random() bias. */
export function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0 || !Number.isFinite(maxExclusive)) return 0;
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % maxExclusive;
}

/** Pick a uniformly-random element from a non-empty array. */
export function randomChoice<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}
