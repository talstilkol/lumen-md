/**
 * Wave g6 lane L4: the Mac pack runner judges a Playwright JSON report per
 * task (scripts/mac-pack/L4.mjs). A skip on Chromium, a flaky test, a
 * browser that never ran the spec, or a failure makes the task not ok; the
 * engine-gap skips of Firefox/WebKit do not.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { CHECKS, judgeGroup, judgeJson } from "../../scripts/mac-pack/L4.mjs";

const ROOT = resolve(__dirname, "../..");
const g = (projects = ["chromium", "firefox", "webkit"], grep: string | null = null) => ({ file: "e2e/x.spec.ts", grep, projects, min: null });
const report = (tests: Array<[string, string]>, title = "a test") => ({
  suites: [{ title: "x.spec.ts", file: "x.spec.ts", specs: [{ title, file: "x.spec.ts", tests: tests.map(([projectName, status]) => ({ projectName, status })) }] }],
});

describe("mac-pack L4 judge", () => {
  it("passes on chromium + firefox, with WebKit's engine-gap skip", () => {
    expect(judgeGroup(report([["chromium", "expected"], ["firefox", "expected"], ["webkit", "skipped"]]), g()).ok).toBe(true);
  });
  it("fails on a skip on chromium, a flaky test, a failure, or a browser that never ran it", () => {
    expect(judgeGroup(report([["chromium", "skipped"], ["firefox", "expected"], ["webkit", "expected"]]), g()).ok).toBe(false);
    expect(judgeGroup(report([["chromium", "flaky"], ["firefox", "expected"], ["webkit", "expected"]]), g()).ok).toBe(false);
    expect(judgeGroup(report([["chromium", "expected"], ["firefox", "unexpected"], ["webkit", "expected"]]), g()).ok).toBe(false);
    expect(judgeGroup(report([["chromium", "expected"], ["firefox", "expected"]]), g()).ok).toBe(false);
  });
  it("judges only the tests its grep names, and nothing found is not a pass", () => {
    const r = report([["chromium", "expected"]], "live-r executes R");
    expect(judgeGroup(r, g(["chromium"], "live-r")).ok).toBe(true);
    expect(judgeGroup(r, g(["chromium"], "live-python")).ok).toBe(false);
  });
  it("reads a JSON field from the last JSON line of a command's output", () => {
    expect(judgeJson('noise\n{"damaged":0,"kills":1000}\n', ["damaged", "==", 0])).toBe(true);
    expect(judgeJson('{"damaged":2}', ["damaged", "==", 0])).toBe(false);
    expect(judgeJson("no json", ["ok", "==", true])).toBe(false);
  });
  it("every spec a task names exists, and every id is a plan task once", () => {
    const ids = CHECKS.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHECKS as Array<{ e2e?: Array<{ file: string }> }>) for (const e of c.e2e ?? []) expect(existsSync(resolve(ROOT, e.file)), e.file).toBe(true);
    const pack = JSON.parse(readFileSync(resolve(ROOT, "plan/mac-pack/L4.json"), "utf8")) as Array<{ id: string }>;
    expect(pack.map((e) => e.id)).toEqual(["L4.all", "L4.e2e", ...ids]);
  });
});
