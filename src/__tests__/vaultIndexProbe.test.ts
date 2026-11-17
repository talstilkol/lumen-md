/**
 * W6.36: e2e/encrypted-reopen.spec.ts drives the sealed snapshot through the
 * e2e probe (window.__lumen.vaultIndex(), src/storage/vaultIndexProbe.ts), so
 * it works against the production build: the probe must offer the snapshot's
 * save and how the last open filled the index, the same objects the index uses.
 */
import { describe, expect, it } from "vitest";
import * as probe from "../storage/vaultIndexProbe";
import * as index from "../storage/workspaceIndex";

describe("the vault index probe (W6.36 e2e)", () => {
  it("offers the sealed snapshot's save and the live open counters", () => {
    expect(probe.saveSnapshotNow).toBe(index.__saveSnapshotNow);
    expect(probe.snapshotCounters).toBe(index.snapshotCounters);
    expect(Object.keys(probe.snapshotCounters).sort()).toEqual(["fromSnapshot", "read"]);
    for (const f of ["ensureIndex", "searchWorkspace", "writeWorkspaceFile"] as const) expect(typeof probe[f]).toBe("function");
  });
});
