/**
 * W13.T1: staged rollout. Each device decides from the signed manifest and
 * its own random install id, which never leaves it; 5% of 10,000 simulated
 * ids must land within ±1%; raising the percent keeps every device that was
 * in; halt stops everyone; a malformed rollout holds. The release side
 * (scripts/lib/rollout.mjs, release-run's --rollout) uses the same rule.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import vectors from "../update/rolloutVectors.json";
import { BUCKETS, admit, bucketOf, installId, newInstallId, parseRollout, threshold } from "../update/stagedRollout";
import { describeRollout, firstStage, nextStage, parseRolloutArgs, rolloutCommand, withRollout } from "../../scripts/lib/rollout.mjs";
import { parseRunArgs } from "../../scripts/lib/releaseRun.mjs";

const digest = async (d: Uint8Array) => new Uint8Array(createHash("sha256").update(d).digest()).buffer;
const ids = (n: number, seed = 1) => {
  // A fixed generator: the test is the same on every run.
  let x = seed >>> 0 || 1;
  const rnd = (a: Uint8Array) => {
    for (let i = 0; i < a.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      a[i] = x & 0xff;
    }
    return a;
  };
  return Array.from({ length: n }, () => newInstallId(() => rnd(new Uint8Array(16))));
};
const manifest = (extra: Record<string, unknown> = {}) => ({ version: "1.5.0", channel: "stable", expires: "2099-01-01T00:00:00Z", platforms: {}, ...extra });

describe("the bucket rule", () => {
  it("matches the shared vectors (the Rust shell is checked against the same file)", async () => {
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(15);
    for (const v of vectors.vectors) expect(await bucketOf(v.installId, v.salt, digest)).toBe(v.bucket);
    // and with WebCrypto, as the app runs it
    for (const v of vectors.vectors.slice(0, 3)) expect(await bucketOf(v.installId, v.salt, (d) => globalThis.crypto.subtle.digest("SHA-256", d as BufferSource))).toBe(v.bucket);
  });

  it("threshold in buckets", () => {
    expect(threshold(5)).toBe(500);
    expect(threshold(0.25)).toBe(25);
    expect(threshold(100)).toBe(BUCKETS);
    expect(threshold(250)).toBe(BUCKETS);
  });
});

describe("5% of 10,000 simulated devices", () => {
  it("lands within ±1% for several salts", async () => {
    const pool = ids(10_000, 7);
    for (const salt of ["v1.5.0", "v1.6.0", "v2.0.0-r2"]) {
      let n = 0;
      for (const id of pool) if ((await bucketOf(id, salt, digest)) < threshold(5)) n++;
      expect(n).toBeGreaterThanOrEqual(400);
      expect(n).toBeLessThanOrEqual(600);
    }
  });

  it("25% and 100% too, and every 5% device is still in at 25%", async () => {
    const pool = ids(10_000, 99);
    const at = async (percent: number) => {
      const s = new Set<string>();
      for (const id of pool) if ((await admit(manifest({ rollout: { percent, salt: "v1.5.0" } }), id)).admit) s.add(id);
      return s;
    };
    const five = await at(5);
    const quarter = await at(25);
    expect(quarter.size).toBeGreaterThanOrEqual(2400);
    expect(quarter.size).toBeLessThanOrEqual(2600);
    for (const id of five) expect(quarter.has(id)).toBe(true);
    expect((await at(100)).size).toBe(10_000);
  });

  it("a different salt picks a different 5%", async () => {
    const pool = ids(2000, 3);
    const inA = new Set<string>();
    for (const id of pool) if ((await bucketOf(id, "v1.5.0", digest)) < 500) inA.add(id);
    let both = 0;
    for (const id of inA) if ((await bucketOf(id, "v1.6.0", digest)) < 500) both++;
    expect(both).toBeLessThan(inA.size / 2);
  });
});

describe("halt, full release and malformed fields", () => {
  const id = "5f2b8c1e9a4d47c3b0e16a7d2c9f8e01";
  it("no rollout field: everyone (the manifests before W13.T1)", async () => {
    expect(await admit(manifest(), id)).toEqual({ admit: true });
  });
  it("halt stops everyone, at any percent", async () => {
    expect(await admit(manifest({ halt: true }), id)).toEqual({ admit: false, reason: "halted" });
    expect(await admit(manifest({ halt: true, rollout: { percent: 100, salt: "s" } }), id)).toEqual({ admit: false, reason: "halted" });
  });
  it("0% is nobody", async () => {
    expect(await admit(manifest({ rollout: { percent: 0, salt: "s" } }), id)).toEqual({ admit: false, reason: "staged" });
  });
  it("a malformed rollout holds the update", async () => {
    for (const rollout of [{ percent: 101, salt: "s" }, { percent: -1, salt: "s" }, { percent: "5", salt: "s" }, { percent: 5 }, { percent: 5, salt: " " }, { percent: 5, salt: "x".repeat(65) }, "5%"]) {
      expect(await admit(manifest({ rollout }), id)).toEqual({ admit: false, reason: "invalid" });
    }
    expect(await admit(manifest({ halt: "yes" }), id)).toEqual({ admit: false, reason: "invalid" });
    expect(() => parseRollout({ rollout: { percent: 5, salt: "v1" } })).not.toThrow();
  });
});

describe("the install id", () => {
  it("is made once, kept, and 128 random bits of hex", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const a = installId(store);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(installId(store)).toBe(a);
    m.set("lumen-install-id", "not-an-id");
    expect(installId(store)).not.toBe("not-an-id");
  });
  it("blocked storage: an id for this check only, no throw", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(installId(broken)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("the release side", () => {
  it("a stable release starts at 5%, a beta at 100%; stages 5 → 25 → 100", () => {
    expect(firstStage("1.5.0")).toBe(5);
    expect(firstStage("1.5.0-beta.2")).toBe(100);
    expect([nextStage(5), nextStage(25), nextStage(100), nextStage(10)]).toEqual([25, 100, 100, 25]);
  });

  it("withRollout writes what the app reads, and 100% drops the field", () => {
    const m = withRollout(manifest(), { percent: 5, salt: "v1.5.0" });
    expect(m.rollout).toEqual({ percent: 5, salt: "v1.5.0" });
    expect(parseRollout(m)).toEqual({ rollout: { percent: 5, salt: "v1.5.0" }, halt: false });
    expect(withRollout(m, { percent: 100, salt: "v1.5.0" }).rollout).toBeUndefined();
    expect(() => withRollout(manifest(), { percent: 5, salt: "" })).toThrow(/salt/);
    expect(describeRollout(m)).toMatch(/5% of devices/);
  });

  it("rollout commands: next, halt, resume, and no silent shrink", () => {
    const now = new Date("2026-11-17T00:00:00Z");
    const five = withRollout(manifest(), { percent: 5, salt: "v1.5.0" });
    const quarter = rolloutCommand(five, { next: true }, { now });
    expect(quarter.rollout).toEqual({ percent: 25, salt: "v1.5.0" });
    expect(Date.parse(quarter.expires)).toBeGreaterThan(now.getTime()); // a fresh expiry: it is signed again
    const halted = rolloutCommand(quarter, { halt: true }, { now });
    expect(halted.halt).toBe(true);
    expect(halted.rollout.percent).toBe(25);
    const resumed = rolloutCommand(halted, { resume: true }, { now });
    expect(resumed.halt).toBeUndefined();
    expect(resumed.rollout.percent).toBe(25);
    expect(rolloutCommand(resumed, { next: true }, { now }).rollout).toBeUndefined();
    expect(() => rolloutCommand(quarter, { percent: 5 }, { now })).toThrow(/--shrink/);
    expect(rolloutCommand(quarter, { percent: 5, allowShrink: true }, { now }).rollout.percent).toBe(5);
    // A full release without a rollout gets the tag as its salt when halted.
    expect(rolloutCommand(manifest(), { halt: true }, { tag: "v1.5.0", now })).toMatchObject({ halt: true });
  });

  it("parses the command line", () => {
    expect(parseRolloutArgs(["v1.5.0", "--percent", "25"])).toMatchObject({ tag: "v1.5.0", percent: 25 });
    expect(parseRolloutArgs(["beta-channel", "--halt", "--dry-run"])).toMatchObject({ halt: true, dryRun: true });
    expect(() => parseRolloutArgs(["v1.5.0"])).toThrow(/exactly one/);
    expect(() => parseRolloutArgs(["v1.5.0", "--halt", "--next"])).toThrow(/exactly one/);
    expect(() => parseRolloutArgs(["v1.5.0", "--percent", "150"])).toThrow(/0 to 100/);
    expect(() => parseRolloutArgs(["--halt"])).toThrow(/usage/);
  });

  it("npm run release takes --rollout N", () => {
    expect(parseRunArgs(["1.5.0", "--dry-run", "--rollout", "10"]).rollout).toBe(10);
    expect(parseRunArgs(["1.5.0", "--dry-run"]).rollout).toBeNull();
    expect(() => parseRunArgs(["1.5.0", "--rollout", "0"])).toThrow(/--rollout/);
    expect(() => parseRunArgs(["1.5.0", "--rollout"])).toThrow(/--rollout/);
  });
});
