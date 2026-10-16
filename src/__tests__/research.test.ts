/** Research worker helpers, citation verifier and research agent (Plan D: D6, D7). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { htmlToText, isFetchableUrl } from "../../edge-workers/research/extract";
import { formatCitationReport, parseCitations, quoteCoverage, verifyCitations } from "../research/citations";
import { citedBlocksToMarkdown, parseAnswer, runResearch } from "../research/agent";
import { setActiveProvider } from "../ai/llm";
import type { ExtractedPage } from "../research/client";

describe("research worker helpers", () => {
  it("fetches public http(s) URLs only", () => {
    for (const ok of ["https://example.org/a?b=1", "http://news.example.com/x"]) expect(isFetchableUrl(ok)).toBe(true);
    for (const bad of [
      "file:///etc/passwd",
      "ftp://example.org/",
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.1.2.3/",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.1/",
      "http://172.20.0.1/",
      "http://[::1]/",
      "http://2130706433/",
      "http://printer.local/",
      "https://user:pw@example.org/",
      "https://example.org:8443/",
      "not a url",
    ])
      expect(isFetchableUrl(bad)).toBe(false);
  });

  it("turns HTML into readable text", () => {
    const html = `<html><head><title>Rose care &amp; pruning</title><script>var x=1</script></head><body>
      <nav>Home | About</nav><article><h1>Pruning roses</h1><p>Prune roses in <b>early spring</b>, when buds swell.</p>
      <ul><li>Use clean shears</li></ul><style>p{}</style></article><footer>© site</footer></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("Rose care & pruning");
    expect(text).toBe("Pruning roses\nPrune roses in early spring, when buds swell.\nUse clean shears");
  });
});

describe("citation verifier", () => {
  const note = [
    "Roses are pruned in spring.[^1] Clean shears matter.[^2]",
    "",
    "```md",
    "[^9]: https://ignored.example/in-code",
    "```",
    "[^1]: [Rose guide](https://roses.example/guide) — “Prune roses in early spring, when buds swell.”",
    '[^2]: https://tools.example/shears "Always use sharp, clean shears"',
    "[^3]: Garden almanac, https://dead.example/page",
    "[^4]: [Other](https://roses.example/guide) — “Roses love being pruned in midsummer heat”",
    "[^5]: No link here",
  ].join("\n");

  it("parses footnotes with links and quotes, skipping code", () => {
    expect(parseCitations(note).map((c) => [c.id, c.url, c.quote ?? null, c.line])).toEqual([
      ["1", "https://roses.example/guide", "Prune roses in early spring, when buds swell.", 6],
      ["2", "https://tools.example/shears", "Always use sharp, clean shears", 7],
      ["3", "https://dead.example/page", null, 8],
      ["4", "https://roses.example/guide", "Roses love being pruned in midsummer heat", 9],
    ]);
  });

  it("measures quote coverage verbatim and approximately", () => {
    const page = "Most gardeners prune roses in early spring — when the buds swell — and feed them in May.";
    expect(quoteCoverage("prune roses in early spring", page)).toBe(1);
    expect(quoteCoverage("Prune roses in early spring, when buds swell.", page)).toBeGreaterThanOrEqual(0.85);
    expect(quoteCoverage("Roses love being pruned in midsummer heat", page)).toBeLessThan(0.5);
  });

  it("verifies each citation once per page and reports problems first", async () => {
    const pages: Record<string, ExtractedPage> = {
      "https://roses.example/guide": { url: "", finalUrl: "", status: 200, text: "Prune roses in early spring, when buds swell. Water deeply." },
      "https://tools.example/shears": { url: "", finalUrl: "", status: 200, text: "Always use sharp, clean shears for every cut." },
      "https://dead.example/page": { url: "", finalUrl: "", status: 404, error: "http-error" },
    };
    const fetchPage = vi.fn(async (u: string) => pages[u]);
    const checks = await verifyCitations(parseCitations(note), fetchPage);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["1", "supported"],
      ["2", "supported"],
      ["3", "dead"],
      ["4", "quote-not-found"],
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(3); // the guide page is read once
    const report = formatCitationReport("notes.md", checks, new Date("2026-10-16T00:00:00Z"));
    expect(report).toContain("**2 to look at**");
    expect(report.indexOf("quote NOT found")).toBeLessThan(report.indexOf("quote found |"));
  });
});

describe("research agent", () => {
  it("turns Claude's cited blocks into a note with verbatim footnotes", () => {
    const { markdown, sources } = citedBlocksToMarkdown(
      "When to prune roses?",
      [
        { text: "Prune in early spring.", citations: [{ url: "https://a.example/x", title: "A", quote: "Prune roses in early spring" }] },
        { text: " Use clean shears.", citations: [{ url: "https://b.example/y", title: "B", quote: "clean shears" }, { url: "https://a.example/x", title: "A", quote: "Prune roses in early spring" }] },
      ],
      new Date("2026-10-16T00:00:00Z"),
    );
    expect(sources).toBe(2);
    expect(markdown).toContain("Prune in early spring.[^1] Use clean shears.[^2][^1]");
    expect(markdown).toContain("[^1]: [A](https://a.example/x) — “Prune roses in early spring”");
    expect(markdown).toContain("[^2]: [B](https://b.example/y) — “clean shears”");
  });

  it("parses the answer and its quotes", () => {
    const { report, quotes } = parseAnswer('Report text [^1].\n---QUOTES---\n[{"n":1,"quote":"exact words"},{"n":"x"}]');
    expect(report).toBe("Report text [^1].");
    expect([...quotes]).toEqual([[1, "exact words"]]);
  });

  describe("search route (Brave / Tavily via the research service)", () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.unstubAllGlobals());

    it("plans, searches, reads, answers and verifies every quote", async () => {
      setActiveProvider("mistral");
      localStorage.setItem("lumen.ai.key.mistral", "m-key");
      const answers = [
        '["prune roses spring", "rose shears"]',
        "Roses are pruned in early spring.[^1] Clean shears prevent disease.[^2] Bananas are blue.[^3]\n---QUOTES---\n" +
          '[{"n":1,"quote":"Prune roses in early spring"},{"n":2,"quote":"Clean shears prevent the spread of disease"}]',
      ];
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: answers.shift() } }] }), { status: 200 })));
      const pages: Record<string, ExtractedPage> = {
        "https://a.example/roses": { url: "https://a.example/roses", finalUrl: "https://a.example/roses", status: 200, title: "Roses", text: "Prune roses in early spring, when buds swell." },
        "https://b.example/shears": { url: "https://b.example/shears", finalUrl: "https://b.example/shears", status: 200, title: "Shears", text: "Sharp shears make clean cuts." },
      };
      const result = await runResearch({
        question: "How do I prune roses?",
        deps: {
          settings: { provider: "brave", key: "k" },
          search: async (q) =>
            q.includes("shears")
              ? [{ title: "Shears", url: "https://b.example/shears", snippet: "" }]
              : [{ title: "Roses", url: "https://a.example/roses", snippet: "" }, { title: "Roses again", url: "https://a.example/roses#top", snippet: "" }],
          extract: async (u) => pages[u],
        },
      });
      expect(result.sources).toBe(2);
      expect(result.unverified).toBe(1); // source 2's quote isn't on the page
      expect(result.markdown).toContain("[^1]: [Roses](https://a.example/roses) — “Prune roses in early spring”");
      expect(result.markdown).toMatch(/\[\^2\]: \[Shears\]\(https:\/\/b\.example\/shears\) — “Clean shears prevent the spread of disease” ⚠️/);
      // A marker for a source that doesn't exist is dropped.
      expect(result.markdown).toContain("Bananas are blue.\n");
      expect(result.markdown).not.toContain("[^3]");
    });
  });

  it("asks for the Anthropic provider for Claude web search", async () => {
    localStorage.clear();
    setActiveProvider("openai");
    await expect(runResearch({ question: "x", deps: { settings: { provider: "claude", key: "" } } })).rejects.toThrow(/Anthropic provider/);
  });
});
