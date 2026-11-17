/**
 * W10.A8 (audit r3): `swallowed()` is how a storage or sync path reports an
 * error it handled by going on: the first one per site reaches the
 * diagnostics ring (content-free), repeats do not flood it, and it never throws.
 */
import { describe, expect, it } from "vitest";
import { recentLogs, swallowed } from "../lib/logger";

describe("swallowed()", () => {
  it("records the first handled error per site, content-free, and never throws", () => {
    const before = recentLogs().length;
    swallowed("storage/test: stat failed", new Error("ENOENT: notes/secret-name.md"));
    swallowed("storage/test: stat failed", new Error("again"));
    swallowed("sync/test: other", "a string");
    const added = recentLogs().slice(before);
    expect(added.map((r) => r.level)).toEqual(["warn", "warn"]);
    expect(added[0].message).toMatch(/^swallowed: storage\/test: stat failed Error: /);
    expect(added[1].message).toMatch(/^swallowed: sync\/test: other/);
    expect(() => swallowed("x", { toString: () => { throw new Error("boom"); } })).not.toThrow();
  });
});
