// @vitest-environment node
/**
 * Audit r3: the owner checklist's header said 841 steps from 427 PRs while
 * `--check` reported 827 / 422. The header now counts what the file lists
 * (its steps, and the PRs those steps name), the same way --check reads the
 * file, and --check fails when the two disagree.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { check, collect, listed, render } from "../../scripts/owner-checklist.mjs";

const ROOT = resolve(__dirname, "..", "..");
const FX = join(ROOT, "src/__tests__/fixtures/owner-checklist");
const prs = JSON.parse(readFileSync(join(FX, "prs.json"), "utf8"));
const plan = JSON.parse(readFileSync(join(FX, "plan.json"), "utf8"));

describe("owner checklist: the header and --check count the same thing", () => {
  it("a fresh page's Hebrew and English headers both equal what the file lists", () => {
    const m = collect({ prs, plan });
    const md = render(m, plan, { generated: "T" }) as string;
    const l = listed(md);
    expect(l.steps).toBe(m.steps.length);
    expect(l.header).toHaveLength(2);
    for (const h of l.header) expect(h).toEqual({ steps: l.steps, prs: l.prs });
    expect(check(m, md)).toMatchObject({ ok: true, headerProblems: [] });
  });

  it("a header that disagrees with the listed steps fails --check", () => {
    const m = collect({ prs, plan });
    const md = render(m, plan, { generated: "T" }) as string;
    const l = listed(md);
    const wrong = md.replace(`· ${l.steps} צעדים מ-${l.prs} PR-ים`, `· ${l.steps + 14} צעדים מ-${l.prs - 2} PR-ים`);
    expect(wrong).not.toBe(md);
    const r = check(m, wrong);
    expect(r.ok).toBe(false);
    expect(r.headerProblems).toEqual([`the header says ${l.steps + 14} steps from ${l.prs - 2} PRs; the file lists ${l.steps} steps from ${l.prs} PRs`]);
  });

  it("the committed checklist's header agrees with its own list", () => {
    const md = readFileSync(join(ROOT, "docs/owner/checklist.md"), "utf8");
    const l = listed(md);
    expect(l.header.length).toBe(2);
    for (const h of l.header) expect(h).toEqual({ steps: l.steps, prs: l.prs });
  });
});
