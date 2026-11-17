/**
 * W13.A4: real "suggest and approve" metrics — acceptance, rejection, edit
 * before accepting, cancellation and time to decide, per agent, counted
 * from the review queue on this device only; the report lists every eval
 * agent; an agent under 30% is marked for the eval.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { approveStagedChange, clearStagedChanges, discardRunChanges, editStagedChange, onStagedChanges, rejectStagedChange, setDocumentApplier, stageChange } from "../agents/staging";
import { FLAG_MIN_DECISIONS, OUTCOMES_KEY, countOutcome, flaggedForEval, loadOutcomes, outcomesReport, setShareOutcomes, shareableOutcomes, trackOutcomes } from "../metrics/suggestionOutcomes";
import { COUNTING_KEY } from "../metrics/usage";
import { EVAL_AGENTS } from "../agents/agentIds";
import { EVAL_CASES } from "../agents/eval/fixtures";

function memStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } } as Storage;
}

const range = (agentId: string, runId = "r1") => stageChange({ kind: "range", path: null, from: 0, to: 1, before: "a", after: "b", summary: "x" }, { tool: "replace_range", agentId, runId });

let s: Storage;
let clock = 0;
let stop: () => void;
beforeEach(() => {
  s = memStorage();
  clock = 0;
  clearStagedChanges();
  // Approving applies to the open document (here: always works).
  setDocumentApplier(() => true);
  stop = trackOutcomes(onStagedChanges, { now: () => Date.now() + clock, storage: s });
});
afterEach(() => {
  stop();
  clearStagedChanges();
});

describe("counting from the review queue", () => {
  it("accept, reject, edit-then-accept and cancel, each with its time to decide", async () => {
    const a = range("proofreader");
    const b = range("proofreader");
    const c = range("proofreader");
    range("tagger", "run-2");
    clock = 3000;
    await approveStagedChange(a.id);
    clock = 5000;
    rejectStagedChange(b.id);
    editStagedChange(c.id, "my own words");
    clock = 8000;
    await approveStagedChange(c.id);
    discardRunChanges("run-2");
    const st = loadOutcomes(s);
    expect(st.agents.proofreader).toEqual({ proposed: 3, accepted: 1, rejected: 1, edited: 1, cancelled: 0, conflict: 0, ms: expect.any(Array) });
    // Time to decide (the staging clock is real; ours runs ahead by `clock`): ~3 s, ~5 s, ~8 s.
    const ms = [...st.agents.proofreader.ms].sort((x, y) => x - y);
    [3000, 5000, 8000].forEach((want, i) => expect(Math.abs(ms[i] - want)).toBeLessThan(500));
    expect(st.agents.tagger).toMatchObject({ proposed: 1, cancelled: 1, accepted: 0 });
  });

  it("each change is counted once, and a change already decided before tracking is not counted", async () => {
    stop();
    const old = range("writer");
    rejectStagedChange(old.id);
    stop = trackOutcomes(onStagedChanges, { now: () => Date.now() + clock, storage: s });
    const x = range("writer");
    await approveStagedChange(x.id);
    range("writer"); // another proposal re-emits the list: x is not counted again
    expect(loadOutcomes(s).agents.writer).toMatchObject({ proposed: 2, accepted: 1, rejected: 0 });
  });

  it("the user's edit replaces the agent's text and only a pending change can be edited", async () => {
    const c = range("stylist");
    expect(editStagedChange(c.id, "mine")).toMatchObject({ after: "mine", edited: true });
    await approveStagedChange(c.id);
    expect(editStagedChange(c.id, "again")?.after).toBe("mine");
  });

  it("nothing is counted when counting is off (W4.26)", async () => {
    s.setItem(COUNTING_KEY, "0");
    const c = range("linker");
    await approveStagedChange(c.id);
    expect(s.getItem(OUTCOMES_KEY)).toBeNull();
  });
});

describe("the report", () => {
  it("lists every eval agent (14+), the used and the unused, with rates", () => {
    // The UI's list is the eval suite's agents.
    expect([...new Set(EVAL_CASES.map((c) => c.agent))].sort()).toEqual([...EVAL_AGENTS].sort());
    expect(EVAL_AGENTS.length).toBeGreaterThanOrEqual(14);
    countOutcome("tagger", "proposed", undefined, s);
    countOutcome("tagger", "accepted", 2000, s);
    const rows = outcomesReport(loadOutcomes(s), EVAL_AGENTS);
    expect(rows.map((r) => r.agent)).toEqual([...EVAL_AGENTS]);
    expect(rows.find((r) => r.agent === "tagger")).toMatchObject({ proposed: 1, decided: 1, acceptRate: 1, medianMs: 2000, flagged: false });
    expect(rows.find((r) => r.agent === "writer")).toMatchObject({ proposed: 0, decided: 0, acceptRate: null, medianMs: null });
  });

  it("an agent under 30% after 10 decisions is flagged for the eval; fewer decisions are not enough", () => {
    for (let i = 0; i < FLAG_MIN_DECISIONS; i++) countOutcome("translator", i < 2 ? "accepted" : "rejected", 1000, s);
    for (let i = 0; i < FLAG_MIN_DECISIONS - 1; i++) countOutcome("charter", "rejected", 1000, s);
    for (let i = 0; i < FLAG_MIN_DECISIONS; i++) countOutcome("outliner", i < 3 ? "edited" : "rejected", 1000, s);
    expect(flaggedForEval(loadOutcomes(s), EVAL_AGENTS)).toEqual(["translator"]);
  });

  it("the median time to decide", () => {
    for (const ms of [1000, 9000, 3000, 5000]) countOutcome("tasker", "accepted", ms, s);
    expect(outcomesReport(loadOutcomes(s), []).find((r) => r.agent === "tasker")!.medianMs).toBe(4000);
  });
});

describe("the counts stay on this device", () => {
  it("the module makes no request (no fetch, no XHR, no beacon)", () => {
    const src = readFileSync("src/metrics/suggestionOutcomes.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    expect(src).not.toMatch(/import .*privacyLedger|import .*network/);
  });

  it("only with the user's consent do they go into the weekly report — counts and rates, no text", () => {
    countOutcome("proofreader", "proposed", undefined, s);
    countOutcome("proofreader", "accepted", 4200, s);
    expect(shareableOutcomes(loadOutcomes(s), EVAL_AGENTS, s)).toBeNull();
    setShareOutcomes(true, s);
    const shared = shareableOutcomes(loadOutcomes(s), EVAL_AGENTS, s)!;
    expect(shared).toEqual([{ agent: "proofreader", proposed: 1, decided: 1, acceptRate: 1, editRate: 0, rejectRate: 0, cancelRate: 0, flagged: false, medianSeconds: 4 }]);
    setShareOutcomes(false, s);
    expect(shareableOutcomes(loadOutcomes(s), EVAL_AGENTS, s)).toBeNull();
  });

  it("a tampered store is read safely (unknown ids and junk dropped)", () => {
    s.setItem(OUTCOMES_KEY, JSON.stringify({ v: 1, agents: { "bad id!": { proposed: 5 }, proofreader: { proposed: -3, accepted: "x", ms: [1, "a", 2] } } }));
    expect(loadOutcomes(s).agents).toEqual({ proofreader: { proposed: 0, accepted: 0, rejected: 0, edited: 0, cancelled: 0, conflict: 0, ms: [1, 0, 2] } });
  });
});
