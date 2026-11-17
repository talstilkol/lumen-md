/**
 * W13.D6 — the known-issues page, built offline from a cached issue list
 * and eval/failures.md, in English and Hebrew, each issue with its workaround.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs tooling, no types
import { PAGES, build, failureEntries, issueEntries, workaroundOf } from "../../scripts/known-issues.mjs";

const ROOT = join(__dirname, "../..");
const row = (n: number, o: Record<string, unknown> = {}) => ({ number: n, title: `Issue ${n}`, html_url: `https://github.com/talstilkol/lumen-md/issues/${n}`, state: "open", body: "", labels: ["known-issue"], ...o });
const FAILURES = "# Agents no measured model passes\n\n## proofreader\n\nThreshold 0.8 over at least 20 cases.\n\n- **qwen**: 0.6 over 20 cases\n";

describe("the known-issues page", () => {
  it("lists an open issue labelled known-issue, with its workaround, in both languages — no network", () => {
    const pages = build([row(7, { title: "PDF export drops niqqud in footnotes", body: "Steps…\n\n## Workaround\n\nExport to HTML and print to PDF.\n" })], FAILURES);
    expect(pages.en).toContain("### #7 PDF export drops niqqud in footnotes");
    expect(pages.en).toContain("**Workaround:** Export to HTML and print to PDF.");
    expect(pages.he).toContain("**עקיפה:** Export to HTML and print to PDF.");
    expect(pages.he).toContain("title: \"בעיות ידועות\"");
  });

  it("leaves out closed issues, pull requests and other labels", () => {
    const rows = [row(1), row(2, { state: "closed" }), row(3, { pull_request: true }), row(4, { labels: ["bug"] }), row(5, { labels: [{ name: "known-issue" }] })];
    expect(issueEntries(rows).map((i: { n: number }) => i.n)).toEqual([1, 5]);
  });

  it("reads the workaround from a heading, a bold label or a Hebrew label", () => {
    expect(workaroundOf("**Workaround:** use Chrome")).toBe("use Chrome");
    expect(workaroundOf("עקיפה: לסגור ולפתוח")).toBe("לסגור ולפתוח");
    expect(workaroundOf("### Workaround\nRestart the app.\nIt helps.\n\n## Other")).toBe("Restart the app. It helps.");
    expect(workaroundOf("nothing here")).toBeNull();
  });

  it("lists the AI agents eval/failures.md says no model passes", () => {
    expect(failureEntries(FAILURES)).toEqual([{ agent: "proofreader", threshold: "0.8 over at least 20 cases" }]);
    expect(build([], FAILURES).en).toContain("- `proofreader` — needs 0.8 over at least 20 cases");
    expect(build([], "").en).toContain("No open issue is labelled `known-issue` right now.");
  });

  it("the committed pages are what the cache and failures.md give (built offline)", () => {
    const rows = JSON.parse(readFileSync(join(ROOT, "docs/src/data/known-issues.json"), "utf8"));
    const pages = build(rows, readFileSync(join(ROOT, "eval/failures.md"), "utf8"));
    expect(readFileSync(join(ROOT, PAGES.en), "utf8")).toBe(pages.en);
    expect(readFileSync(join(ROOT, PAGES.he), "utf8")).toBe(pages.he);
  });
});
