/** 0.13 — the handoff document: PR stack, worktrees, and a check that every name in it exists. */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs helper without types
import { parseWorktrees, prTree, missingRefs, renderHandoff } from "../../scripts/lib/handoff.mjs";

const prs = [
  { number: 196, head: "fix/abort-all", base: "fix/honest-small", title: "abort", ci: "success", ciSha: "3ef33e7b", unanswered: 0 },
  { number: 194, head: "fix/codex-backlog", base: "feat/pwa-real", title: "codex | fixes", ci: null, unanswered: 2 },
  { number: 195, head: "fix/honest-small", base: "fix/codex-backlog", title: "small", ci: "failure", unanswered: 1 },
  { number: 206, head: "fix/review-194-r2", base: "fix/codex-backlog", title: "r2", ci: "success", unanswered: 0 },
];

describe("handoff", () => {
  it("parses git worktree --porcelain, detached heads included", () => {
    const text = "worktree /a\nHEAD 1234567890abcdef\nbranch refs/heads/fix/x\n\nworktree /b\nHEAD abcdef1234567890\ndetached\n";
    expect(parseWorktrees(text)).toEqual([
      { path: "/a", head: "12345678", branch: "fix/x" },
      { path: "/b", head: "abcdef12", branch: null },
    ]);
  });

  it("shows the PRs as a stack: children under the PR whose head is their base, siblings in number order", () => {
    expect(prTree(prs).map((l: { depth: number; pr: { number: number } }) => [l.depth, l.pr.number])).toEqual([
      [0, 194],
      [1, 195],
      [2, 196],
      [1, 206],
    ]);
  });

  it("lists every branch or worktree it names that does not exist", () => {
    const problems = missingRefs({ prs, worktrees: [{ path: "/w", branch: "gone/branch", head: "x" }], branches: ["fix/abort-all", "fix/codex-backlog", "fix/honest-small"] });
    expect(problems).toEqual(["PR #206: branch fix/review-194-r2 is not here (git fetch?)", "worktree /w: branch gone/branch is gone"]);
  });

  it("renders the task, the stack with CI marks, escaped titles and the checks", () => {
    const md = renderHandoff({ now: "2026-10-18T05:00:00Z", repo: "o/r", task: "0.13", next: "open the PR", prs, worktrees: [{ path: "/w", branch: "fix/x", head: "abc" }], problems: [] });
    expect(md).toContain("- **Current task:** 0.13");
    expect(md).toContain("| #194 | `fix/codex-backlog` → `feat/pwa-real` | ⏳ | 2 | codex \\| fixes |");
    expect(md).toContain("| ↳ ↳ #196 |");
    expect(md).toContain("❌");
    expect(md).toContain("Every branch and worktree named above exists.");
    const bad = renderHandoff({ now: "t", repo: "o/r", task: null, next: null, prs: [], worktrees: [], problems: ["x is gone"] });
    expect(bad).toContain("- ⚠️ x is gone");
    expect(bad).toContain("- **Current task:** —");
  });
});
