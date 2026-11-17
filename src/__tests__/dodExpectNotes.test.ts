/**
 * Review 12, H3: W6.39's dod went green only because plan:check's output
 * changed. dodExpect stripped the text in parentheses, so "(no wave is over
 * its WIP limit while the next wave has started)" was dropped, and the one
 * clause left, prints no `plan: WIP —`, was met once plan:check printed the
 * decided pairs as "10 wave pairs over the limit held by a written
 * decision". Now a note keeps its checks (only its exit codes and counts are
 * history), the phrase also forbids that summary line, and W6.39's dod reads
 * the exit code of `plan:check --wip-none`, which no wording can change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error -- plain .mjs script, no types
import { parseExpect, unmetExpect } from "../../scripts/lib/dodExpect.mjs";

const REPO = resolve(__dirname, "../..");
const DECIDED_OUT = [
  "plan: work in progress — 10 wave pairs over the limit held by a written decision at frozen numbers (plan.schedule.wipDecisions, W10.G6); no new start in them.",
  "plan: MASTER_PLAN.md, plan/board.html and public/roadmap.html match plan/plan.json",
].join("\n");
type Task = { id: string; dod?: string[]; dodExpect?: string[]; status?: string };
const w639 = (): Task => (JSON.parse(readFileSync(resolve(REPO, "plan/plan.json"), "utf8")).phases as { tasks: Task[] }[]).flatMap((p) => p.tasks).find((t) => t.id === "W6.39")!;

describe("a note in parentheses never strips a check (review 12, H3)", () => {
  it("a phrase or a forbidden print inside parentheses is still a clause; a count there is still history", () => {
    const old = "exit 0 — prints no `plan: WIP —` (no wave is over its WIP limit while the next wave has started)";
    expect(parseExpect(old).map((c: { kind: string }) => c.kind)).toEqual(["exit", "absent", "phrase"]);
    expect(parseExpect("exit 0 (never prints `skipped`)")).toMatchObject([{ kind: "exit" }, { kind: "absent", text: "skipped" }]);
    expect(parseExpect("exit 0 (51/51 on 16.11)").map((c: { kind: string }) => c.kind)).toEqual(["exit"]);
  });

  it("the decided-pairs summary line does not meet 'no wave is over its WIP limit'", () => {
    const old = "exit 0 — prints no `plan: WIP —` (no wave is over its WIP limit while the next wave has started)";
    expect(unmetExpect(old, { code: 0, out: DECIDED_OUT })).toEqual([expect.stringMatching(/a wave over its WIP limit/)]);
    expect(unmetExpect(old, { code: 0, out: "plan: MASTER_PLAN.md … match plan/plan.json\n" })).toEqual([]);
  });

  it("W6.39's dod is the exit code of plan:check --wip-none, and its status says it is held by decision", () => {
    const t = w639();
    expect(t.dod?.[0]).toBe("npm run plan:check -- --wip-none");
    expect(parseExpect(t.dodExpect?.[0])).toMatchObject([{ kind: "exit", code: 0 }, { kind: "phrase" }]);
    expect(unmetExpect(t.dodExpect?.[0], { code: 1, out: DECIDED_OUT })).toEqual([expect.stringMatching(/exit 0 expected, got 1/), expect.stringMatching(/a wave over its WIP limit/)]);
    expect(t.status).toMatch(/held by decision/);
    expect(t.status?.startsWith("✅")).toBe(false);
  });
});
