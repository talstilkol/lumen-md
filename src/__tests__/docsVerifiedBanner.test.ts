/**
 * W13.D2 — "only what's verified": a docs page tied to plan tasks that are
 * not verified in a real browser yet opens with a beta notice, in both
 * languages; a feature page without a task id fails the audit.
 * With the W13.D1 page checks (Diátaxis type, numbered steps in a tutorial)
 * and the W13.D4 doctest's block reader, which share the same library.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs tooling, no types
import { BANNER_MARK, bannerFor, checkPages, frontMatter, hasNumberedSteps, isBrowserVerified, pages, planTaskMap, withBanner } from "../../scripts/lib/docsMeta.mjs";
// @ts-expect-error — plain .mjs tooling, no types
import remarkVerifiedBanner from "../../docs/src/plugins/remark-verified-banner.mjs";
// @ts-expect-error — plain .mjs tooling, no types
import { extractBlocks, markOf } from "../../scripts/docs-doctest.mjs";

const ROOT = join(__dirname, "../..");
const DOCS = join(ROOT, "docs/src/content/docs");
const plan = JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
const TASKS: Map<string, { verified?: string }> = planTaskMap(plan);

const fake = new Map([
  ["W1.1", { verified: "built" }],
  ["W1.2", { verified: "browser" }],
  ["W1.3", { verified: "node" }],
  ["W1.4", {}],
  ["W1.5", { verified: "owner" }],
]);

describe("the beta notice", () => {
  it("appears for a task below 'browser' (built, node, unset), not for browser or owner", () => {
    expect(bannerFor(["W1.1"], fake)).toContain("Beta — not verified yet");
    expect(bannerFor(["W1.3"], fake)).toContain("W1.3");
    expect(bannerFor(["W1.4"], fake)).not.toBeNull();
    expect(bannerFor(["W1.2"], fake)).toBeNull();
    expect(bannerFor(["W1.5"], fake)).toBeNull();
    expect(bannerFor([], fake)).toBeNull();
    // An unknown id is not verified.
    expect(bannerFor(["W9.99"], fake)).not.toBeNull();
  });

  it("names only the tasks still pending, in Hebrew on a Hebrew page (ids isolated LTR)", () => {
    const he = bannerFor(["W1.1", "W1.2"], fake, "he")!;
    expect(he).toContain("בטא — עוד לא אומת");
    expect(he).toContain("⁦W1.1⁩");
    expect(he).not.toContain("W1.2");
  });

  it("withBanner puts it after the front matter, once", () => {
    const page = "---\ntitle: X\ntasks: [\"W1.1\"]\n---\n\nBody.\n";
    const out = withBanner(page, fake, "en");
    expect(out.indexOf(BANNER_MARK)).toBeGreaterThan(out.indexOf("---\n\n") - 1);
    expect(withBanner(out, fake, "en")).toBe(out);
    expect(withBanner("---\ntitle: X\ntasks: [\"W1.2\"]\n---\nBody", fake, "en")).not.toContain(BANNER_MARK);
  });
});

describe("the docs site plugin (remark)", () => {
  const tmpPlan = (() => {
    const d = mkdtempSync(join(tmpdir(), "plan-"));
    const p = join(d, "plan.json");
    writeFileSync(p, JSON.stringify({ tasks: [{ id: "W1.1", title: "built one", minutes: 1, verified: "built" }, { id: "W1.2", title: "browser one", minutes: 1, verified: "browser" }] }));
    return p;
  })();
  const run = (path: string, tasks: string[]) => {
    const tree = { type: "root", children: [{ type: "paragraph", children: [] }] } as { children: Array<{ type: string; value?: string }> };
    remarkVerifiedBanner({ plan: tmpPlan })(tree, { path, data: { astro: { frontmatter: { tasks } } } });
    return tree.children;
  };

  it("adds the notice as an aside on a page of a built task", () => {
    const kids = run("/x/docs/src/content/docs/editor/a.md", ["W1.1"]);
    expect(kids[0].type).toBe("html");
    expect(kids[0].value).toContain('class="starlight-aside starlight-aside--caution"');
    expect(kids[0].value).toContain("<strong>Beta — not verified yet.</strong>");
  });

  it("in Hebrew on a Hebrew page; nothing on a verified page or a page without tasks", () => {
    expect(run("/x/docs/src/content/docs/he/editor/a.md", ["W1.1"])[0].value).toContain("בטא");
    expect(run("/x/docs/src/content/docs/editor/a.md", ["W1.2"])[0].type).toBe("paragraph");
    expect(run("/x/docs/src/content/docs/editor/a.md", [])[0].type).toBe("paragraph");
  });

  it("on the real docs and plan: a page of a task verified only to 'built' gets it, a browser-verified one does not", () => {
    const featurePages = pages(DOCS).filter((r: string) => !r.startsWith("he/"));
    const withTasks = featurePages
      .map((r: string) => ({ r, tasks: (frontMatter(readFileSync(join(DOCS, r), "utf8"))?.data.tasks ?? []) as string[] }))
      .filter((x: { tasks: string[] }) => Array.isArray(x.tasks) && x.tasks.length);
    const built = withTasks.find((x: { tasks: string[] }) => x.tasks.every((id) => TASKS.get(id)?.verified === "built"));
    expect(built, "a page whose tasks are all at 'built'").toBeTruthy();
    const kids = (() => {
      const tree = { type: "root", children: [] as Array<{ type: string; value?: string }> };
      remarkVerifiedBanner()(tree, { path: join(DOCS, built!.r), data: { astro: { frontmatter: { tasks: built!.tasks } } } });
      return tree.children;
    })();
    expect(kids[0]?.value).toContain("Beta");
    const verified = withTasks.find((x: { tasks: string[] }) => x.tasks.every((id) => isBrowserVerified(TASKS.get(id))));
    if (verified) {
      const tree = { type: "root", children: [] as Array<{ type: string }> };
      remarkVerifiedBanner()(tree, { path: join(DOCS, verified.r), data: { astro: { frontmatter: { tasks: verified.tasks } } } });
      expect(tree.children).toHaveLength(0);
    }
  });
});

describe("the audit's page checks (W13.D1, W13.D2)", () => {
  const known = new Set(["W1.1"]);
  const files: Record<string, string> = {
    "editor/ok.md": "---\ntitle: A\ntype: how-to\ntasks: [\"W1.1\"]\n---\nx",
    "he/editor/ok.md": "---\ntitle: א\ntype: how-to\ntasks: [\"W1.1\"]\n---\nx",
    "editor/no-task.md": "---\ntitle: B\ntype: how-to\n---\nx",
    "editor/untracked.md": "---\ntitle: B\ntype: reference\nuntracked: \"before the plan\"\n---\nx",
    "editor/unknown-task.md": "---\ntitle: B\ntype: how-to\ntasks: [\"W7.77\"]\n---\nx",
    "project/no-type.md": "---\ntitle: C\n---\nx",
    "project/bad-type.md": "---\ntitle: C\ntype: guide\n---\nx",
    "getting-started/tut.md": "---\ntitle: T\ntype: tutorial\n---\nJust prose.",
    "getting-started/tut-ok.md": "---\ntitle: T\ntype: tutorial\n---\n1. a\n2. b\n3. c\n",
    "he/editor/mismatch.md": "---\ntitle: מ\ntype: reference\ntasks: [\"W1.1\"]\n---\nx",
    "editor/mismatch.md": "---\ntitle: M\ntype: how-to\ntasks: [\"W1.1\"]\n---\nx",
  };
  const found = checkPages(Object.keys(files), (r: string) => files[r], known) as Array<{ page: string; problem: string }>;
  const bad = (page: string) => found.filter((f) => f.page === page).map((f) => f.problem).join(" | ");

  it("flags a feature page without a task id, or with one the plan does not have", () => {
    expect(bad("editor/no-task.md")).toMatch(/without a task id/);
    expect(bad("editor/unknown-task.md")).toMatch(/W7\.77 is not in the plan/);
    expect(bad("editor/untracked.md")).toBe("");
  });
  it("flags a page without a Diátaxis type, or with another word", () => {
    expect(bad("project/no-type.md")).toMatch(/no Diátaxis type/);
    expect(bad("project/bad-type.md")).toMatch(/not one of/);
  });
  it("a tutorial needs numbered steps", () => {
    expect(bad("getting-started/tut.md")).toMatch(/numbered steps/);
    expect(bad("getting-started/tut-ok.md")).toBe("");
    expect(hasNumberedSteps("```\n1. a\n2. b\n3. c\n```")).toBe(false);
  });
  it("a Hebrew page has its English twin's type and tasks", () => {
    expect(bad("he/editor/mismatch.md")).toMatch(/differs from the English/);
    expect(bad("he/editor/ok.md")).toBe("");
  });
  it("the real docs pass: every page typed, every feature page tied to a task, 3 Hebrew tutorials", () => {
    const rels = pages(DOCS);
    expect(rels.length).toBeGreaterThan(500);
    const real = checkPages(rels, (r: string) => readFileSync(join(DOCS, r), "utf8"), new Set(TASKS.keys()));
    expect(real).toEqual([]);
    const heTutorials = rels.filter((r: string) => r.startsWith("he/") && frontMatter(readFileSync(join(DOCS, r), "utf8"))?.data.type === "tutorial");
    expect(heTutorials.length).toBeGreaterThanOrEqual(3);
  });
});

describe("doctest blocks (W13.D4)", () => {
  it("reads fences and their marks", () => {
    const md = "a\n```sh run\nnode x.mjs\n```\n\n```bash illustrative\nrm -rf /\n```\n````js\nconst a = 1;\n````\n";
    const b = extractBlocks(md);
    expect(b.map((x: { lang: string; meta: string }) => [x.lang, markOf(x.meta)])).toEqual([["sh", "run"], ["bash", "illustrative"], ["js", null]]);
    expect(b[0].code).toBe("node x.mjs");
  });
});
