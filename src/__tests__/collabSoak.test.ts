/**
 * Plan W2.20 acceptance 3 — the soak, full size: a 1 MB document, 5
 * participants, 1,000 random edits over the app's end-to-end encrypted
 * transport and the public server's E2EE-only check, with a hostile network
 * (random delivery order, a participant offline and back every 100 edits).
 * 0 loss: the five documents converge, every inserted marker is there once,
 * the room refused nothing and holds no plaintext, and nothing readable
 * crossed the wire. The harness is scripts/bench/collab-soak.ts.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { fillerDocument, runSoak, soakProblems } from "../../scripts/bench/collab-soak";
import { compactAt } from "../collab/e2e";

describe("collaboration soak (W2.20): 1 MB, 5 participants, 1,000 random edits", () => {
  // Three seeds: different delivery orders, offline spells and compaction races.
  for (const seed of [20_261_117, 1, 2]) {
    it(`seed ${seed}: loses nothing, converges, stays under the server's room limit, and carries ciphertext only`, async () => {
      const r = await runSoak({ participants: 5, edits: 1000, docBytes: 1_000_000, seed });
      console.info(`[W2.20] soak seed ${seed}: ${r.participants} participants, ${r.edits} edits (${r.ops.insert} insert / ${r.ops.delete} delete / ${r.ops.replace} replace), ${r.docBytes} B document, ${r.markers} markers, ${r.offlineSpells} offline spells, room ${r.roomBytes} B (peak ${r.roomPeakBytes}, ${r.snapshotsInRoom} snapshots, ${r.tooLarge} too large), wire ${r.wireBytes} B in ${r.wireMessages} messages, envelopes now ${r.envelopes.join("/")}, ${r.ms} ms`);
      expect(r.participants).toBe(5);
      expect(r.edits).toBe(1000);
      expect(r.docBytes).toBeGreaterThanOrEqual(1_000_000);
      expect(r.offlineSpells).toBeGreaterThanOrEqual(4);
      expect(r.ops.delete + r.ops.replace).toBeGreaterThan(200);
      expect(soakProblems(r)).toEqual([]);
      expect(r.lost).toEqual([]);
      expect(r.converged).toBe(true);
    }, 600_000);
  }

  it("peers compact at different points, never above the threshold", () => {
    expect(compactAt(500, 0)).toBe(500);
    expect(compactAt(500, 249)).toBe(251);
    expect(compactAt(500, 250)).toBe(500);
    expect(compactAt(4, 1)).toBe(3);
    expect(compactAt(1, 99)).toBe(1);
    const points = new Set([123456789, 987654321, 55555, 4242424, 77].map((id) => compactAt(500, id)));
    expect(points.size).toBe(5);
    for (const p of points) expect(p).toBeLessThanOrEqual(500);
  });

  it("the verdict names every way a soak can fail", () => {
    const ok = { participants: 5, edits: 1, docBytes: 1, ops: { insert: 1, delete: 0, replace: 0 }, markers: 1, lost: [], duplicated: [], converged: true, finalChars: 1, refused: [], roomBytes: 10, roomPeakBytes: 10, roomMaxBytes: 100, tooLarge: 0, snapshotsInRoom: 1, wireBytes: 1, wireMessages: 1, plaintextOnWire: [], plaintextInRoom: [], offlineSpells: 0, envelopes: [1], decryptErrors: 0, ms: 1 };
    expect(soakProblems(ok)).toEqual([]);
    expect(soakProblems({ ...ok, converged: false, lost: ["«p1e2»"], duplicated: ["«p0e1»"], refused: ["participant 1: incomplete"], roomPeakBytes: 101, tooLarge: 1, plaintextOnWire: ["x"], plaintextInRoom: ["y"], decryptErrors: 2 })).toHaveLength(8);
  });

  it("the filler is the asked size, one sentence per line, Hebrew and English", () => {
    const f = fillerDocument(10_000);
    expect(new TextEncoder().encode(f).byteLength).toBeGreaterThanOrEqual(10_000);
    expect(f).toMatch(/[א-ת]/);
    expect(f).toMatch(/[A-Za-z]/);
  });

  it("would see a loss: a participant whose edits never reach the room fails the soak", async () => {
    // The same harness with a broken link: participant 2's updates are dropped before the room.
    let dropped = 0;
    const r = await runSoak({ participants: 3, edits: 60, docBytes: 20_000, churnEvery: 1000, seed: 7, room: "lumen-soak-broken", dropToRoom: (from) => from === 2 && ++dropped > 0 });
    expect(dropped).toBeGreaterThan(0);
    expect(soakProblems(r).join("; ")).toMatch(/lost|differ/);
  }, 120_000);
});
