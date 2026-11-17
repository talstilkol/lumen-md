// @vitest-environment node
/**
 * Review Z6-L2 (c9a7149ed2): the Percy step exits 0 on every unlabelled PR build, and the receipt listed it as a
 * pass although Percy never ran. Now the step leaves a policy-skip marker, and the receipt records
 * "skipped-by-policy": not a failure, and never shown as a pass. The agent is a fake (`buildkite-agent` answers).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs without types
import { POLICY_SKIP_KEY, SKIPPED_BY_POLICY, collectOutcomes, receiptReport } from "../../../scripts/buildkite/lib.mjs";

type Run = { status: number | null; stdout: string };
/** A fake `buildkite-agent`: every step's outcome, and the build's meta-data. */
const agent = (outcomes: Record<string, string>, meta: Record<string, string> = {}) => (args: string[]): Run => {
  if (args[0] === "step") return { status: 0, stdout: `${outcomes[args[4]] ?? ""}\n` };
  if (args[0] === "meta-data" && args[1] === "get") return { status: 0, stdout: meta[args[2]] ?? "" };
  return { status: 1, stdout: "" };
};
const report = (o: { outcomes: Record<string, string>; skips?: Record<string, string> }) => receiptReport({ commit: {}, build: {}, machine: {}, ...o });

describe("Percy skipped by policy (Z6-L2)", () => {
  it("the committed pipeline's Percy step leaves the marker before it exits 0 unasked", () => {
    const steps = (parse(readFileSync(".buildkite/pipeline.yml", "utf8")) as { steps: Array<{ key?: string; command?: string }> }).steps;
    const percy = steps.find((s) => s.key === "percy")!;
    const skip = percy.command!.split("\n").find((l) => l.includes('"main"'))!;
    expect(skip).toContain(`buildkite-agent meta-data set "${POLICY_SKIP_KEY("percy")}"`);
    expect(skip.indexOf("meta-data set")).toBeLessThan(skip.indexOf("exit 0"));
    expect(percy.command).toContain("npm run -s visual:percy");
  });

  it("a passed Percy job with the marker is recorded as skipped, not as a pass, and fails nothing", () => {
    const { outcomes, skips } = collectOutcomes(["lint", "percy"], agent({ lint: "passed", percy: "passed" }, { [POLICY_SKIP_KEY("percy")]: "not run: runs on main and on PRs labelled percy" }));
    expect(outcomes).toEqual({ lint: "passed", percy: SKIPPED_BY_POLICY });
    const r = report({ outcomes, skips });
    expect(r.suites.percy).toEqual({ ok: true, skipped: true, detail: "skipped by policy: not run: runs on main and on PRs labelled percy" });
    expect(r.suites.lint).toEqual({ ok: true, detail: "passed" });
  });

  it("Percy that ran is a pass; Percy that failed is a failure, marker or not", () => {
    expect(collectOutcomes(["percy"], agent({ percy: "passed" })).outcomes.percy).toBe("passed");
    expect(report({ outcomes: { percy: "passed" } }).suites.percy).toEqual({ ok: true, detail: "passed" });
    const failed = collectOutcomes(["percy"], agent({ percy: "failed" }, { [POLICY_SKIP_KEY("percy")]: "x" }));
    expect(failed.outcomes.percy).toBe("failed");
    expect(report(failed).suites.percy.ok).toBe(false);
  });

  it("no other gate can be skipped by a marker (it stays as its job ended)", () => {
    const got = collectOutcomes(["e2e-webkit", "lint"], agent({ "e2e-webkit": "passed", lint: "passed" }, { [POLICY_SKIP_KEY("e2e-webkit")]: "x", [POLICY_SKIP_KEY("lint")]: "x" }));
    expect(got.outcomes).toEqual({ "e2e-webkit": "passed", lint: "passed" });
    // Even a forged outcome does not pass a gate that may not be skipped.
    expect(report({ outcomes: { lint: SKIPPED_BY_POLICY } }).suites.lint.ok).toBe(false);
  });
});
