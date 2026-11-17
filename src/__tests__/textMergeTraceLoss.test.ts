/**
 * W1.9 regression: a clean merge never loses a character. Either everything
 * both sides wrote is kept, or the merge asks.
 *
 * Found by W11.S7 on the public editing traces. In 4 of the 2,700 split
 * pairs, both sides wrote the same new text at the same place: a newline,
 * "00", " | any // Timeout?", "dable". The engine took it once, as "the same
 * change on both sides", and dropped the other side's characters (59 in all).
 *
 * The fixtures in fixtures/merge-traces/lost-characters.json are DERIVED from
 * those real traces by scripts/bench/merge-traces-shrink.ts. Each names its
 * source file (repo, pinned commit, sha256) and pair. Each is a subset of
 * that pair's own characters, and its expected text is exact. None is
 * synthetic. When the traces themselves are on this machine, the whole pairs
 * are checked too (LUMEN_TRACE_DIR, laid out as for merge-traces.ts --from).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeText, onlyDeletes } from "../sync/merge/textMerge";
import { classify, makePairs, parseEditingTrace, sha256 } from "../../scripts/bench/merge-traces-lib";

interface Fixture {
  source: { repo: string; commit: string; path: string; sha256: string };
  window: number;
  checkpoint: number;
  dependent: boolean;
  fullPairLost: number;
  lostBefore: number;
  base: string;
  ours: string;
  theirs: string;
  expected: string;
}
const file = JSON.parse(readFileSync("src/__tests__/fixtures/merge-traces/lost-characters.json", "utf8")) as { about: string; fixtures: Fixture[] };
const manifest = JSON.parse(readFileSync("bench/merge-traces/manifest.json", "utf8")) as { sets: Array<{ id: string; repo: string; commit: string; files: Array<{ path: string; sha256: string }> }> };
const asPair = (f: Fixture) => ({ trace: f.source.path, at: f.checkpoint, window: f.window, base: f.base, ours: f.ours, theirs: f.theirs, expected: f.expected, reanchored: 0, droppedDeletes: 0 });

describe("the fixtures are derived from the pinned public traces", () => {
  it("labelled as derived, each naming a file of the manifest by its pinned commit and sha256", () => {
    expect(file.about).toMatch(/^DERIVED from the real public editing traces/);
    expect(file.about).toMatch(/not synthetic/i);
    expect(file.fixtures.length).toBe(4);
    for (const f of file.fixtures) {
      const set = manifest.sets.find((s) => s.repo === f.source.repo && s.commit === f.source.commit);
      expect(set?.files.find((x) => x.path === f.source.path)?.sha256, f.source.path).toBe(f.source.sha256);
      // Small, a real three-way merge, and it lost characters before the fix.
      expect(f.base.length + f.ours.length + f.theirs.length).toBeLessThan(200);
      expect(new Set([f.base, f.ours, f.theirs]).size).toBe(3);
      expect(f.lostBefore).toBeGreaterThan(0);
    }
    // The 4 pairs W11.S7 measured with a loss: 59 characters.
    expect(file.fixtures.map((f) => [f.source.path.split("/").pop(), f.window, f.checkpoint, f.fullPairLost])).toEqual([
      ["json-crdt-patch.json.gz", 200, 3250, 1],
      ["json-crdt-patch.json.gz", 1000, 7907, 5],
      ["sveltecomponent.json.gz", 200, 4794, 24],
      ["sveltecomponent.json.gz", 200, 16159, 29],
    ]);
  });
});

describe("no clean merge loses a character (real-trace fixtures)", () => {
  for (const f of file.fixtures) {
    it(`${f.source.path.split("/").pop()} W=${f.window} at ${f.checkpoint}: kept whole, or the merge asks`, () => {
      const out = classify(asPair(f), mergeText);
      expect(out.lost, JSON.stringify(mergeText(f.base, f.ours, f.theirs).text)).toBe(0);
      // In all four, both sides wrote the same text at one place: the merge asks,
      // and the dialog shows both versions whole.
      const m = mergeText(f.base, f.ours, f.theirs);
      expect(m.clean).toBe(false);
      expect(m.text).toContain("<<<<<<<");
    });
  }
});

describe("the rule behind it", () => {
  it("the same new text written by both sides at one place asks, a newline included", () => {
    // Both add a blank line after "a": one each, so one in the merge would drop one.
    const r = mergeText("a\nb\nc\nd\n", "a\n\nb\nc\nd!\n", "x\na\n\nb\nc\nd\n");
    expect(r.clean).toBe(false);
    // Both type " fast" after the same word.
    expect(mergeText("x\nthe car\ny\nz\n", "x\nthe car fast\ny\nz!\n", "w\nx\nthe car fast\ny\nz\n").clean).toBe(false);
  });

  it("the same deletion on both sides still merges: nothing was written, nothing can be lost", () => {
    const r = mergeText("a\nold line\nb\nc\n", "a\nb\nc!\n", "z\na\nb\nc\n");
    expect(r).toEqual({ clean: true, conflicts: 0, text: "z\na\nb\nc!\n" });
    // A word deleted from the same line on both sides (deleting only, inside the line).
    const w = mergeText("a\nlet width = 50\nb\nc\n", "a\nlet width = 0\nb\nc!\n", "z\na\nlet width = 0\nb\nc\n");
    expect(w).toEqual({ clean: true, conflicts: 0, text: "z\na\nlet width = 0\nb\nc!\n" });
  });

  it("different edits still merge as before", () => {
    expect(mergeText("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n")).toEqual({ clean: true, conflicts: 0, text: "A\nb\nC\n" });
  });

  it("two whole versions that are equal are one version, not a merge", () => {
    expect(mergeText("a\n", "a b\n", "a b\n")).toEqual({ clean: true, conflicts: 0, text: "a b\n" });
  });

  it("onlyDeletes: a subsequence of base, by code point", () => {
    expect(onlyDeletes("let width = 50\n", "let width = 0\n")).toBe(true);
    expect(onlyDeletes("human-rea ", "human-readable ")).toBe(false);
    expect(onlyDeletes("\n", "\n\n")).toBe(false);
    expect(onlyDeletes("a😀b", "ab")).toBe(true);
    expect(onlyDeletes("ab", "")).toBe(true);
  });
});

const traceDir = process.env.LUMEN_TRACE_DIR;
// skip-reason: the full editing traces are a large outside checkout (LUMEN_TRACE_DIR); the committed real-trace fixtures always run | task: W11.S7 | until: 2027-05-16
describe.skipIf(!traceDir || !existsSync(join(traceDir, "editing-traces")))("the whole pairs, from the traces on this machine", () => {
  it("each of the 4 pairs: nothing lost now", () => {
    const set = manifest.sets.find((s) => s.id === "editing-traces")!;
    for (const f of file.fixtures) {
      const buf = readFileSync(join(traceDir!, "editing-traces", f.source.path));
      expect(sha256(buf)).toBe(f.source.sha256);
      expect(set.files.find((x) => x.path === f.source.path)?.sha256).toBe(f.source.sha256);
      const name = f.source.path.split("/").pop()!.replace(/\.json\.gz$/, "");
      const pair = makePairs(parseEditingTrace(buf, name), f.window).find((p) => p.at === f.checkpoint)!;
      expect(classify(pair, mergeText).lost).toBe(0);
    }
  });
});
