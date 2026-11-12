// Review 2 (RR2-469-1): the public collab server limits new rooms, per day on the whole server, per
// address (IPv4, or IPv6 /64) and per IPv6 /48, and how many rooms are stored at once.
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM server module, no types
import { addressParts, admit, dayOf, quotaBuckets, quotaLimits } from "../../sync-server/collab/roomQuota.mjs";
// @ts-expect-error -- plain ESM server module, no types
import { Quota } from "../../edge-workers/collab/worker.mjs";

type Counts = { day: string; rooms: number; stored: number; buckets: Map<string, number> };
const fresh = (): Counts => ({ day: "", rooms: 0, stored: 0, buckets: new Map() });

function memState() {
  const data = new Map<string, unknown>();
  return {
    data,
    storage: {
      async list() {
        return new Map(data);
      },
      async put(o: Record<string, unknown>) {
        for (const [k, v] of Object.entries(o)) data.set(k, v);
      },
      async deleteAll() {
        data.clear();
      },
    },
  };
}

describe("new-room limits (roomQuota.mjs)", () => {
  it("counts IPv4 by address, IPv6 by /64 and /48, and IPv4-mapped as IPv4", () => {
    expect(addressParts("203.0.113.7")).toEqual({ address: "203.0.113.7", p48: null });
    expect(addressParts("::ffff:203.0.113.7")).toEqual({ address: "203.0.113.7", p48: null });
    expect(addressParts("2001:db8:1:2:aaaa::1")).toEqual({ address: "2001:db8:1:2::/64", p48: "2001:db8:1::/48" });
    expect(addressParts("[2001:db8:1:2:bbbb::9]").address).toBe("2001:db8:1:2::/64");
  });

  it("keeps no address: bucket names are HMACs under a key for the day", () => {
    const a = quotaBuckets("s".repeat(40), "2001:db8:1:2::1", "2026-11-12");
    expect(a.keys).toHaveLength(2);
    for (const k of a.keys) expect(k).toMatch(/^[ap]:[\w-]{22}$/);
    expect(JSON.stringify(a)).not.toContain("2001");
    // The same /64 the same day: the same buckets; another day: others.
    expect(quotaBuckets("s".repeat(40), "2001:db8:1:2::ffff", "2026-11-12").keys).toEqual(a.keys);
    expect(quotaBuckets("s".repeat(40), "2001:db8:1:2::1", "2026-11-13").keys[0]).not.toBe(a.keys[0]);
    expect(quotaBuckets("s".repeat(40), "203.0.113.7").keys).toHaveLength(1);
  });

  it("refuses past the per-address, per-/48, daily and stored limits, and starts over the next day", () => {
    const L = quotaLimits({ COLLAB_NEW_ROOMS_PER_DAY: "10", COLLAB_NEW_ROOMS_PER_ADDRESS: "2", COLLAB_NEW_ROOMS_PER_48: "3", COLLAB_MAX_ROOMS: "5" });
    expect(L).toEqual({ perDay: 10, perAddress: 2, per48: 3, maxRooms: 5 });
    const c = fresh();
    const day = "2026-11-12";
    const v6 = (i: number) => quotaBuckets("k".repeat(40), `2001:db8:7:${i}::1`, day).keys;
    expect(admit(c, v6(1), day, L)).toBeNull();
    expect(admit(c, v6(1), day, L)).toBeNull();
    expect(admit(c, v6(1), day, L)).toBe("address");
    // Another /64 in the same /48: one more, then the /48 is full.
    expect(admit(c, v6(2), day, L)).toBeNull();
    expect(admit(c, v6(3), day, L)).toBe("prefix");
    // Other addresses: up to the daily cap.
    for (let i = 0; i < 7; i++) expect(admit(c, quotaBuckets("k".repeat(40), `198.51.100.${i}`, day).keys, day, L)).toBeNull();
    expect(admit(c, quotaBuckets("k".repeat(40), "198.51.100.99", day).keys, day, L)).toBe("day");
    // The next day the daily counts start over; the stored rooms don't.
    c.stored = 5;
    expect(admit(c, v6(1), "2026-11-13", L)).toBe("rooms-full");
    c.stored = 4;
    expect(admit(c, v6(1), "2026-11-13", L)).toBeNull();
    expect(c.rooms).toBe(1);
  });

  it("the Quota object keeps its counts in storage, drops yesterday's buckets, and counts stored rooms", async () => {
    const st = memState();
    const env = { COLLAB_NEW_ROOMS_PER_ADDRESS: "1" };
    const q = new Quota(st, env);
    const k = quotaBuckets("k".repeat(40), "203.0.113.7", "2026-11-12").keys;
    expect(await q.admit(k, "2026-11-12")).toBeNull();
    // Woken again (a new instance): the count was kept.
    const q2 = new Quota(st, env);
    expect(await q2.admit(k, "2026-11-12")).toBe("address");
    expect(await q2.admit(["junk"], "2026-11-12")).toBeNull(); // malformed bucket names are ignored, the day still counts
    expect(await q2.stored(1)).toBe(1);
    expect(await q2.admit(quotaBuckets("k".repeat(40), "203.0.113.7", "2026-11-13").keys, "2026-11-13")).toBeNull();
    expect([...st.data.keys()].filter((x) => x.startsWith("b:"))).toHaveLength(1);
    expect(st.data.get("stored")).toBe(1);
    expect(await q2.stored(-1)).toBe(0);
    expect(await q2.stored(-1)).toBe(0);
    expect(dayOf(Date.UTC(2026, 10, 12, 23, 59))).toBe("2026-11-12");
  });
});
