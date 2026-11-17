/**
 * W13.T1: the boot sentinel's rollback rule. Two failed starts of a new
 * version → the last version that started cleanly is named for rollback;
 * the desktop shell restores its own kept copy of it (src-tauri/src/
 * boot_sentinel.rs, tested with rustc --test), never one from a manifest.
 * The rule here and the shell's are the same; these cases pin it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { beginBoot, decide, markBootOk, resetBootForTests, SENTINEL_KEY, type SentinelState } from "../boot/bootSentinel";
import { readFileSync } from "node:fs";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
afterEach(() => resetBootForTests());

describe("two failed starts → rollback to the last good version", () => {
  it("1.4.2 ran; 1.5.0 fails twice; the third start names 1.4.2", () => {
    const local = mem();
    const session = mem();
    let now = 1_700_000_000_000;
    const start = (v: string) => {
      resetBootForTests();
      now += 60_000;
      return beginBoot(v, { storage: local, session, now, search: "" });
    };
    start("1.4.2");
    markBootOk({ storage: local });
    expect(start("1.5.0")).toMatchObject({ failures: 0, rollbackTo: null, safeMode: false });
    expect(start("1.5.0")).toMatchObject({ failures: 1, rollbackTo: null, safeMode: true });
    expect(start("1.5.0")).toMatchObject({ failures: 2, rollbackTo: "1.4.2", safeMode: true });
    expect(JSON.parse(local.getItem(SENTINEL_KEY)!).good).toBe("1.4.2");
  });

  it("no rollback when the last good version is this one (it broke later: safe mode, not a downgrade)", () => {
    const prev: SentinelState = { v: 1, version: "1.5.0", pending: true, failures: 3, good: "1.5.0", at: 0 };
    expect(decide(prev, "1.5.0", 10_000).decision).toMatchObject({ rollbackTo: null, safeMode: true });
  });

  it("no rollback without a good version on record (first install)", () => {
    const prev: SentinelState = { v: 1, version: "1.5.0", pending: true, failures: 1, good: null, at: 0 };
    expect(decide(prev, "1.5.0", 10_000).decision.rollbackTo).toBeNull();
  });

  it("a version installed after a failed one keeps the older good version", () => {
    const prev: SentinelState = { v: 1, version: "1.5.0", pending: true, failures: 2, good: "1.4.2", at: 0 };
    const { next, decision } = decide(prev, "1.5.1", 10_000);
    expect(next.good).toBe("1.4.2");
    expect(decision).toMatchObject({ failures: 0, safeMode: false });
  });

  it("the desktop shell applies the same threshold (FAILURES_BEFORE_ROLLBACK = 2) and restores only its own copy", () => {
    const rs = readFileSync(new URL("../../src-tauri/src/boot_sentinel.rs", import.meta.url), "utf8");
    expect(rs).toMatch(/pub const FAILURES_BEFORE_ROLLBACK: u32 = 2;/);
    expect(rs).toMatch(/\(Some\(g\), Some\(k\)\) if g != current && k == g => Action::Rollback/);
    const glue = readFileSync(new URL("../../src-tauri/src/updates.rs", import.meta.url), "utf8");
    // The copy is kept before the update installs, and the rollout is decided from the verified manifest.
    expect(glue.indexOf("keep_running_build(&app);")).toBeGreaterThan(0);
    expect(glue.indexOf("keep_running_build(&app);")).toBeLessThan(glue.indexOf("up.download_and_install"));
    expect(glue).toMatch(/rollout::admit\(&fields, &install_id\(&app\)\)/);
    expect(glue.indexOf("rollout::admit")).toBeGreaterThan(glue.indexOf("manifest_sig::verify_manifest"));
  });
});
