/**
 * W11.S7 (research R3.8): the merge engine measured on public editing
 * traces (josephg/editing-traces, crdt-benchmarks B4) instead of pairs we
 * generated. The traces themselves are not in the repository (see
 * bench/merge-traces/manifest.json); the real run is
 * `npm run bench:merge-traces`, and its numbers are in
 * bench/merge-traces/results.json.
 *
 * Every trace in THIS file is a tiny SYNTHETIC fixture written here in the
 * published formats, to test the loaders, the pair cutting and the counting.
 * None of it is presented as measured data.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { mergeText } from "../sync/merge/textMerge";
import {
  ACCEPT,
  ConcurrentReplay,
  PRIMARY_WINDOW,
  accepted,
  classify,
  classifyConcurrent,
  concurrentPairs,
  decodeJsString,
  makePair,
  makePairs,
  parseB4,
  parseConcurrentTrace,
  parseEditingTrace,
  replay,
  sha256,
  tally,
  type Patch,
} from "../../scripts/bench/merge-traces-lib";

/** Synthetic sequential trace: types two lines, then edits each. */
const synthetic = {
  startContent: "",
  endContent: "alpha beta\ngamma delta!\n",
  txns: [
    { time: "2026-11-15T00:00:00Z", patches: [[0, 0, "alpha\ngamma\n"]] },
    { time: "2026-11-15T00:00:01Z", patches: [[5, 0, " beta"]] },
    { time: "2026-11-15T00:00:02Z", patches: [[16, 0, " delta"]] },
    { time: "2026-11-15T00:00:03Z", patches: [[22, 0, "!"]] },
  ],
};
const gz = (o: unknown) => gzipSync(Buffer.from(JSON.stringify(o)));
const chars = (s: string) => Array.from(s);

describe("loaders (synthetic fixtures in the published formats)", () => {
  it("editing-traces: gzipped or plain JSON, replays to endContent", () => {
    const t = parseEditingTrace(gz(synthetic), "synthetic");
    expect(t.txns).toHaveLength(4);
    expect(replay(t)).toBe("alpha beta\ngamma delta!\n");
    expect(parseEditingTrace(Buffer.from(JSON.stringify(synthetic)), "plain").txns).toHaveLength(4);
    expect(() => replay({ ...t, endContent: "other" })).toThrow(/does not give endContent/);
    expect(() => parseEditingTrace(gz({ txns: [] }), "bad")).toThrow(/not an editing-traces file/);
    expect(() => parseEditingTrace(gz({ endContent: "", txns: [{ patches: [] }] }), "bad")).toThrow(/no patches/);
  });

  it("B4: read as text, single- and double-quoted inserts, escapes; the file is never executed", () => {
    const js = [
      "// @ts-nocheck",
      "globalThis.__b4Executed = true",
      'export const finalText = "a\\\\b\'\\n"',
      "export const edits = [",
      "  [0, 0, 'a'],",
      "  [1, 0, '\\\\'],",
      "  [2, 0, 'x'],",
      "  [2, 1],",
      "  [2, 0, 'b'],",
      `  [3, 0, "'"],`,
      "  [4, 0, '\\n']",
      "]",
    ].join("\n");
    const t = parseB4(js, "b4:synthetic");
    expect(t.txns).toHaveLength(7);
    expect(replay(t)).toBe("a\\b'\n");
    expect((globalThis as Record<string, unknown>).__b4Executed).toBeUndefined();
    expect(() => parseB4("export const x = 1")).toThrow(/no finalText or edits/);
  });

  it("JS string escapes", () => {
    expect(decodeJsString("a\\'b\\\"c\\\\d\\n\\t\\u05d0\\x41\\u{1F600}")).toBe("a'b\"c\\d\n\tאA😀");
  });

  it("concurrent traces: replays branches and merges to endContent (the format's own example plus a fork)", () => {
    const doc = {
      kind: "concurrent",
      endContent: "yoooo ho ho\n",
      numAgents: 2,
      txns: [
        { parents: [], agent: 0, patches: [[0, 0, "hi there\n"]] },
        { parents: [0], agent: 0, patches: [[0, 8, ""], [0, 0, "yoooo"]] },
        { parents: [1], agent: 1, patches: [[5, 0, " ho ho"]] },
      ],
    };
    const r = new ConcurrentReplay(parseConcurrentTrace(gz(doc), "readme-example"));
    expect(r.finalText()).toBe("yoooo ho ho\n");
    expect(concurrentPairs(r)).toEqual([]);

    // Synthetic fork: both agents edit the common "one\ntwo\n" at once, then merge.
    const fork = {
      kind: "concurrent",
      endContent: "one!\ntwo?\n",
      numAgents: 2,
      txns: [
        { parents: [], agent: 0, patches: [[0, 0, "one\ntwo\n"]] },
        { parents: [0], agent: 0, patches: [[3, 0, "!"]] },
        { parents: [0], agent: 1, patches: [[7, 0, "?"]] },
        { parents: [1, 2], agent: 0, patches: [] },
      ],
    };
    const rf = new ConcurrentReplay(parseConcurrentTrace(gz(fork), "fork"));
    expect(rf.finalText()).toBe("one!\ntwo?\n");
    const [p] = concurrentPairs(rf);
    expect(p).toMatchObject({ at: 3, base: "one\ntwo\n", ours: "one!\ntwo\n", theirs: "one\ntwo?\n", expected: "one!\ntwo?\n" });
    expect(classifyConcurrent(p, mergeText)).toEqual({ merged: true, lost: 0, extra: 0, exact: true });
    expect(() => parseConcurrentTrace(gz(synthetic), "x")).toThrow(/not a concurrent/);
  });
});

describe("cutting one author's history into two windows", () => {
  it("ours is the document after the first window; with independent windows, expected is the document after both", () => {
    const t = parseEditingTrace(gz(synthetic), "s");
    const base = chars("alpha\ngamma\n");
    const p = makePair("s", 1, 1, base, [t.txns[1]], [t.txns[2]]);
    expect(p.ours).toBe("alpha beta\ngamma\n");
    expect(p.theirs).toBe("alpha\ngamma delta\n");
    expect(p.expected).toBe("alpha beta\ngamma delta\n");
    expect(p).toMatchObject({ reanchored: 0, droppedDeletes: 0 });
    expect(classify(p, mergeText)).toEqual({ merged: true, lost: 0, extra: 0, exact: true });
  });

  it("a second-window insert right after the first window's text is a same-place insert; a delete of it is dropped", () => {
    const base = chars("ab\n");
    const first: Patch[][] = [[[1, 0, "XY"]]]; // a X Y b
    const second: Patch[][] = [[[3, 0, "Z"]], [[2, 1, ""]]]; // types Z after Y, deletes Y (which the other device never had)
    const p = makePair("s", 0, 1, base, first, second);
    expect(p.ours).toBe("aXYb\n");
    expect(p.theirs).toBe("aZb\n");
    expect(p.expected).toBe("aXYZb\n");
    expect(p).toMatchObject({ reanchored: 1, droppedDeletes: 1 });
    // Both inserted at the same place: the engine asks rather than guess an order.
    expect(classify(p, mergeText).merged).toBe(false);
  });

  it("pairs come at evenly spaced checkpoints, deterministically; a trace too short gives none", () => {
    const long = { startContent: "", endContent: "", txns: Array.from({ length: 50 }, (_, i) => ({ patches: [[i, 0, i % 10 === 9 ? "\n" : "x"]] })) };
    long.endContent = Array.from({ length: 50 }, (_, i) => (i % 10 === 9 ? "\n" : "x")).join("");
    const t = parseEditingTrace(gz(long), "long");
    const a = makePairs(t, 5, 4);
    expect(a.map((p) => p.at)).toEqual([8, 16, 24, 32]);
    expect(makePairs(t, 5, 4)).toEqual(a);
    expect(makePairs(t, 30, 4)).toEqual([]);
  });
});

describe("counting", () => {
  it("a merge that drops or doubles a character is counted as lost or extra, not hidden", () => {
    const p = makePair("s", 0, 1, chars("one\ntwo\n"), [[[3, 0, "!"]]], [[[8, 0, "?"]]]);
    const dropOne = () => ({ clean: true, text: "one\ntwo?\n" });
    expect(classify(p, dropOne)).toEqual({ merged: true, lost: 1, extra: 0, exact: false });
    const doubled = () => ({ clean: true, text: "one!!\ntwo?\n" });
    expect(classify(p, doubled)).toMatchObject({ lost: 0, extra: 1 });
    const t = tally([p, p], [classify(p, dropOne), classify(p, mergeText)]);
    expect(t).toMatchObject({ pairs: 2, merged: 2, lostChars: 1, pairsWithLoss: 1, exact: 1 });
    expect(accepted(t)).toBe(false);
  });

  it("a dependent split pair's difference is reported apart, not as lost; its dialog still counts", () => {
    const dep = makePair("s", 0, 1, chars("ab\n"), [[[1, 0, "XY"]]], [[[2, 1, ""]]]); // deletes X, which only ours had
    expect(dep).toMatchObject({ droppedDeletes: 1, reanchored: 0 });
    const ind = makePair("s", 0, 1, chars("one\ntwo\n"), [[[3, 0, "!"]]], [[[8, 0, "?"]]]);
    const dropOne = () => ({ clean: true, text: "x" });
    const t = tally([dep, ind], [classify(dep, dropOne), classify(ind, mergeText)]);
    expect(t).toMatchObject({ pairs: 2, merged: 2, lostChars: 0, dependentPairs: 1, dependentPairsWithLoss: 1 });
    expect(t.dependentLostChars).toBeGreaterThan(0);
  });

  it("the acceptance is ≥ 90 % merged and 0 lost, frozen", () => {
    expect(ACCEPT).toEqual({ mergedRate: 0.9, lost: 0 });
    expect(Object.isFrozen(ACCEPT)).toBe(true);
    expect(PRIMARY_WINDOW).toBe(200);
  });
});

describe("the manifest and the committed results", () => {
  const manifest = JSON.parse(readFileSync("bench/merge-traces/manifest.json", "utf8")) as { sets: Array<{ id: string; repo: string; commit: string; format: string; files: Array<{ path: string; sha256: string; bytes: number }> }> };

  it("both public sets, each file pinned to a commit and a sha256", () => {
    expect(manifest.sets.map((s) => s.repo)).toEqual(["josephg/editing-traces", "josephg/editing-traces", "dmonad/crdt-benchmarks"]);
    expect(manifest.sets.map((s) => s.format)).toEqual(["editing-traces", "concurrent", "b4"]);
    for (const s of manifest.sets) {
      expect(s.commit).toMatch(/^[0-9a-f]{40}$/);
      for (const f of s.files) {
        expect(f.sha256, f.path).toMatch(/^[0-9a-f]{64}$/);
        expect(f.bytes).toBeGreaterThan(0);
      }
    }
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("the committed results' verdicts agree with their own numbers", () => {
    const f = "bench/merge-traces/results.json";
    if (!existsSync(f)) return;
    const r = JSON.parse(readFileSync(f, "utf8"));
    expect(r.real.total.pairs).toBeGreaterThan(0);
    expect(r.real.accepted).toBe(r.real.total.mergedRate >= ACCEPT.mergedRate && r.real.total.lostChars <= ACCEPT.lost);
    expect(r.split.accepted).toBe(r.split.primary.mergedRate >= ACCEPT.mergedRate && r.split.primary.lostChars <= ACCEPT.lost);
    expect(r.split.primaryWindow).toBe(PRIMARY_WINDOW);
  });
});
