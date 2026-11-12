/**
 * New-room limits for the public collab server (review 2 RR2-469-1, review 4).
 *
 * One Durable Object (`Quota`, one instance named "quota") counts, per UTC day:
 *   - new rooms on the whole server   COLLAB_NEW_ROOMS_PER_DAY      (default 2,000)
 *   - new rooms per client address     COLLAB_NEW_ROOMS_PER_ADDRESS  (default 20)
 *     (an IPv4 address, or an IPv6 /64)
 *   - new rooms per IPv6 /48           COLLAB_NEW_ROOMS_PER_48       (default 4 × the per-address limit)
 * and, all the time, the rooms that are stored: COLLAB_MAX_ROOMS (default 1,000).
 * With MAX_ROOM_BYTES at 4 MB, 1,000 rooms are at most 4 GB, under the Workers
 * Free plan's 5 GB of Durable Object storage.
 *
 * Why a Durable Object and not the Workers rate-limit binding: the binding
 * needs wrangler 4.36 (the deploy script pins 4.20.0), counts per Cloudflare
 * location, not globally, is eventually consistent, and only knows periods of
 * 10 or 60 seconds. A daily cap on the whole server needs one exact counter.
 *
 * What it keeps: counts under bucket names that are an HMAC of the address
 * under a key for the day (from COLLAB_TOKEN_SECRET), so no address is stored,
 * and yesterday's buckets are dropped with the day. A room is counted once,
 * when its first peer authenticates and nothing of it is stored yet.
 * The counter itself is the `Quota` Durable Object in edge-workers/collab/worker.mjs;
 * this file is its pure part (tested in plain Node).
 */
import { createHmac } from "node:crypto";

const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

/** The UTC day of `nowMs`, e.g. "2026-11-12". */
export const dayOf = (nowMs = Date.now()) => new Date(nowMs).toISOString().slice(0, 10);

/** The eight 16-bit groups of an IPv6 address, or null (the rule of sync-server/vault-relay.js, #483). */
function v6Groups(a) {
  if (!/^[0-9a-f:.]+$/i.test(a) || !a.includes(":")) return null;
  let tail = [];
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((x) => x > 255)) return null;
    tail = [((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16)];
    a = a.slice(0, v4.index) + "0:0";
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const g = [...head, ...Array(Math.max(0, fill)).fill("0"), ...rest];
  if (g.length !== 8 || g.some((x) => !/^[0-9a-f]{1,4}$/i.test(x))) return null;
  if (v4) g.splice(6, 2, ...tail);
  return g.map((x) => parseInt(x, 16));
}

/**
 * What a client is counted as: `{address, p48}`. `address` is an IPv4 address
 * (IPv4-mapped IPv6 too) or an IPv6 /64; `p48` is the IPv6 /48, or null.
 */
export function addressParts(raw) {
  let a = String(raw || "?").trim().toLowerCase();
  if (a.startsWith("[")) a = a.slice(1, a.indexOf("]") >>> 0);
  a = a.replace(/%.*$/, "");
  const g = v6Groups(a);
  if (!g) return { address: a, p48: null };
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return { address: `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`, p48: null };
  const hex = (n) => g.slice(0, n).map((x) => x.toString(16)).join(":");
  return { address: `${hex(4)}::/64`, p48: `${hex(3)}::/48` };
}

/**
 * The bucket names for a client on `day`: ["a:<hmac>"] and, for IPv6,
 * "p:<hmac>" for its /48. Cloudflare sets CF-Connecting-IP; a client can't.
 */
export function quotaBuckets(secret, rawAddress, day = dayOf()) {
  const key = createHmac("sha256", String(secret || "")).update(`lumen-collab quota v1|${day}`).digest();
  const h = (s) => createHmac("sha256", key).update(s).digest("base64url").slice(0, 22);
  const { address, p48 } = addressParts(rawAddress);
  return { day, keys: [`a:${h(address)}`, ...(p48 ? [`p:${h(p48)}`] : [])] };
}

/** The limits, from the Worker's vars. */
export function quotaLimits(env = {}) {
  const perAddress = Math.max(1, Math.floor(num(env.COLLAB_NEW_ROOMS_PER_ADDRESS, 20)));
  return {
    perDay: Math.max(1, Math.floor(num(env.COLLAB_NEW_ROOMS_PER_DAY, 2000))),
    perAddress,
    per48: Math.max(perAddress, Math.floor(num(env.COLLAB_NEW_ROOMS_PER_48, 4 * perAddress))),
    maxRooms: Math.max(1, Math.floor(num(env.COLLAB_MAX_ROOMS, 1000))),
  };
}

/**
 * The decision, as a pure function of the counts: `counts` is
 * {day, rooms, stored, buckets: Map}. Returns null to admit (and counts it),
 * or the reason: "rooms-full" | "day" | "address" | "prefix".
 */
export function admit(counts, keys, day, limits) {
  if (counts.day !== day) {
    counts.day = day;
    counts.rooms = 0;
    counts.buckets = new Map();
  }
  if (counts.stored >= limits.maxRooms) return "rooms-full";
  if (counts.rooms >= limits.perDay) return "day";
  for (const k of keys) {
    const cap = k.startsWith("p:") ? limits.per48 : limits.perAddress;
    if ((counts.buckets.get(k) ?? 0) >= cap) return k.startsWith("p:") ? "prefix" : "address";
  }
  counts.rooms++;
  for (const k of keys) counts.buckets.set(k, (counts.buckets.get(k) ?? 0) + 1);
  return null;
}
