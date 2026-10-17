/** Research worker helpers, citation verifier and research agent (Plan D: D6, D7). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { charsetOf, htmlToText, isFetchableUrl } from "../../edge-workers/research/extract";
import { formatCitationReport, parseCitations, quoteCoverage, verifyCitations } from "../research/citations";
import { citedBlocksToMarkdown, parseAnswer, runResearch } from "../research/agent";
import { setActiveProvider } from "../ai/llm";
import type { ExtractedPage } from "../research/client";
import { anthropicWebResearch, MAX_RESEARCH_TURNS } from "../ai/anthropicProvider";
import { costOf } from "../ai/usage";

describe("quoteCoverage bounds", () => {
  it("stays fast on a long quote with repeated opening words against a long page", async () => {
    const { quoteCoverage } = await import("../research/citations");
    const quote = Array.from({ length: 600 }, (_, k) => (k % 2 ? "the" : `w${k}`)).join(" ");
    const page = Array.from({ length: 60_000 }, (_, k) => (k % 3 ? "the" : `p${k}`)).join(" ");
    const t = performance.now();
    expect(quoteCoverage(quote, page)).toBeLessThan(0.85);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

describe("research worker helpers", () => {
  it("fetches public http(s) URLs only", () => {
    for (const ok of ["https://example.org/a?b=1", "http://news.example.com/x", "http://example.org:80/", "https://example.org:443/"]) expect(isFetchableUrl(ok)).toBe(true);
    for (const bad of [
      "file:///etc/passwd",
      "ftp://example.org/",
      "http://localhost/",
      "http://localhost./",
      "http://metadata.google.internal./",
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
      // Each scheme only on its own default port.
      "http://example.org:443/",
      "https://example.org:80/",
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

  it("keeps an article's own header but drops the site header", () => {
    const html = `<body><header>Site menu</header><article><header><h1>Headline</h1><p>The lead passage.</p></header><p>Body text.</p></article></body>`;
    expect(htmlToText(html).text).toBe("Headline\nThe lead passage.\nBody text.");
    expect(htmlToText(`<body><header>Site menu</header><p>Body text.</p></body>`).text).toBe("Body text.");
  });

  it("reads quoted and unquoted charsets", () => {
    expect(charsetOf('text/html; charset="windows-1252"')).toBe("windows-1252");
    expect(charsetOf("text/html;charset=ISO-8859-1")).toBe("ISO-8859-1");
    expect(charsetOf("text/html")).toBe("utf-8");
    expect(charsetOf(null)).toBe("utf-8");
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
    // Same words, reversed: not a match.
    const q = "one two three four five six seven eight nine ten";
    expect(quoteCoverage(q, q.split(" ").reverse().join(" "))).toBeLessThan(0.5);
  });

  it("finds a quote whose opening words aren't on the page", () => {
    const quote = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const page = `Intro text. ${quote.split(" ").slice(3).join(" ")} Outro.`;
    expect(quoteCoverage(quote, page)).toBeCloseTo(27 / 30, 5);
  });

  it("skips a Markdown link title when reading the quote", () => {
    const [c] = parseCitations('[^1]: [Source](https://example.com "Official site") — “the actual passage on the page”');
    expect(c.url).toBe("https://example.com");
    expect(c.quote).toBe("the actual passage on the page");
    expect(parseCitations("[^1]: [S](https://example.com 'Title') “another real passage”")[0].quote).toBe("another real passage");
  });

  it("doesn't call a quote missing when only the start of a long page was read", async () => {
    const [c] = parseCitations("[^1]: https://long.example/page “a passage much further down the page”");
    const page: ExtractedPage = { url: c.url, finalUrl: c.url, status: 200, text: "The beginning of a very long page.", truncated: true };
    const [check] = await verifyCitations([c], async () => page);
    expect(check.status).toBe("not-in-excerpt");
    const report = formatCitationReport("n.md", [check]);
    expect(report).toContain("**1 to look at**");
    expect(report).toContain("part of the page that was read");
    // Untruncated, the same miss is a definite one.
    expect((await verifyCitations([c], async () => ({ ...page, truncated: false })))[0].status).toBe("quote-not-found");
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
    const flagged = citedBlocksToMarkdown("Q", [
      { text: "## Findings\n", citations: [] },
      { text: "Cited claim.", citations: [{ url: "https://a.example", title: "A", quote: "q" }] },
      { text: " Roses also grow well on the moon according to many gardeners.", citations: [] },
    ]);
    expect(flagged.unverified).toBe(1);
    expect(flagged.markdown).toContain("many gardeners. ⚠️ *no source cited*");
    expect(flagged.markdown).not.toContain("Findings ⚠️");
    expect(markdown).toContain("[^1]: [A](https://a.example/x) — “Prune roses in early spring”");
    expect(markdown).toContain("[^2]: [B](https://b.example/y) — “clean shears”");
  });

  it("parses the answer and its quotes", () => {
    const { report, quotes } = parseAnswer('Report text [^1].\n---QUOTES---\n[{"n":1,"quote":"exact words"},{"n":"x"}]');
    expect(report).toBe("Report text [^1].");
    expect([...quotes]).toEqual([[1, ["exact words"]]]);
    // An explicit claim number keeps alignment when an earlier quote is missing.
    const q2 = parseAnswer('R [^1] [^1]\n---QUOTES---\n[{"n":1,"i":2,"quote":"second"}]').quotes.get(1)!;
    expect(q2[0]).toBeUndefined();
    expect(q2[1]).toBe("second");
    expect(parseAnswer('R\n---QUOTES---\n[{"n":1,"quote":""},{"n":1,"quote":"b"}]').quotes.get(1)).toEqual(["", "b"]);
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
      expect(result.unverified).toBe(2); // source 2's quote isn't on the page; [^3] wasn't read
      expect(result.markdown).toContain("[^1]: [Roses](https://a.example/roses) — “Prune roses in early spring”");
      expect(result.markdown).toMatch(/\[\^2\]: \[Shears\]\(https:\/\/b\.example\/shears\) — “Clean shears prevent the spread of disease” ⚠️/);
      // A marker for a source that wasn't read is flagged, not dropped.
      expect(result.markdown).toContain("Bananas are blue. ⚠️ *cites a source that wasn't read*");
      expect(result.markdown).not.toContain("[^3]");
    });

    it("gives every cited claim its own quote, and stops before searching on provider errors", async () => {
      setActiveProvider("mistral");
      localStorage.setItem("lumen.ai.key.mistral", "m-key");
      const answers = [
        '["roses"]',
        "Prune in spring.[^1] Roses are blue.[^1] A separate unsupported claim follows here, quite long.\n\nAn unmarked paragraph that makes a claim without any footnote at all.\n---QUOTES---\n" +
          '[{"n":1,"quote":"Prune roses in early spring"}]',
      ];
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: answers.shift() } }] }), { status: 200 })));
      const page: ExtractedPage = { url: "https://a.example/r", finalUrl: "https://a.example/r", status: 200, title: "Roses", text: "Prune roses in early spring." };
      const deps = { settings: { provider: "brave" as const, key: "k" }, search: async () => [{ title: "Roses", url: "https://a.example/r", snippet: "" }], extract: async () => page };
      const result = await runResearch({ question: "Roses?", deps });
      expect(result.unverified).toBe(3);
      expect(result.markdown).toContain("unsupported claim follows here, quite long. ⚠️ *no source cited*");
      expect(result.markdown).toContain("Prune in spring.[^1] Roses are blue.[^2]");
      expect(result.markdown).toContain("without any footnote at all. ⚠️ *no source cited*");
      expect(result.markdown).toMatch(/\[\^2\]: \[Roses\]\(https:\/\/a\.example\/r\) ⚠️ \*no supporting quote given\*/);
      // The planner call fails (provider error): no search is spent.
      vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
      const search = vi.fn(deps.search);
      await expect(runResearch({ question: "Roses?", deps: { ...deps, search } })).rejects.toThrow();
      expect(search).not.toHaveBeenCalled();
    });

    it("ignores markers in code, sees them after closing quotes, and checks prose under a heading", async () => {
      setActiveProvider("mistral");
      localStorage.setItem("lumen.ai.key.mistral", "m-key");
      const answers = [
        '["roses"]',
        "## Findings\nThis unsupported claim sits right under the heading and is long enough.\n\n" +
          "The source calls this “an exceptionally important result for every gardener.”[^1] Write `text[^1]` for a footnote.\n\n" +
          "```md\nAn example sentence inside a code block that carries a marker.[^1]\n```\n---QUOTES---\n" +
          '[{"n":1,"quote":"Prune roses in early spring"}]',
      ];
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: answers.shift() } }] }), { status: 200 })));
      const page: ExtractedPage = { url: "https://a.example/r", finalUrl: "https://a.example/r", status: 200, title: "Roses", text: "Prune roses in early spring." };
      const result = await runResearch({
        question: "Roses?",
        deps: { settings: { provider: "brave", key: "k" }, search: async () => [{ title: "Roses", url: "https://a.example/r", snippet: "" }], extract: async () => page },
      });
      expect(result.unverified).toBe(1); // only the claim under the heading
      expect(result.markdown).toContain("long enough. ⚠️ *no source cited*");
      expect(result.markdown).not.toContain("Findings ⚠️");
      expect(result.markdown).toContain("every gardener.”[^1] Write `text[^1]` for a footnote.");
      expect(result.markdown).toContain("carries a marker.[^1]\n```");
      expect(result.markdown).not.toContain("[^2]");
    });
  });

  it("asks for the Anthropic provider for Claude web search", async () => {
    localStorage.clear();
    setActiveProvider("openai");
    await expect(runResearch({ question: "x", deps: { settings: { provider: "claude", key: "" } } })).rejects.toThrow(/Anthropic provider/);
  });

  it("finishes a paused turn with searching off once the budget is spent", async () => {
    localStorage.clear();
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    const bodies: Array<{ tool_choice?: unknown }> = [];
    const replies = [
      { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1" }], usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 5 } } },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Answer.", citations: [] }], usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify(replies.shift()));
    }));
    const blocks = await anthropicWebResearch([{ role: "user", content: "q?" }], { maxSearches: 5 });
    expect(blocks.map((b) => b.text)).toEqual(["Answer."]);
    expect(bodies[1].tool_choice).toEqual({ type: "none" });
    vi.unstubAllGlobals();
  });

  it("fails rather than returning a turn still paused after the last continuation", async () => {
    localStorage.clear();
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ stop_reason: "pause_turn", content: [{ type: "text", text: "Partial…", citations: [] }], usage: { input_tokens: 1, output_tokens: 1 } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(anthropicWebResearch([{ role: "user", content: "q?" }])).rejects.toThrow(/didn't finish/);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RESEARCH_TURNS);
    vi.unstubAllGlobals();
  });

  it("applies the AI rate limits to web research and charges the quota once per run", async () => {
    localStorage.clear();
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    const release: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      release.push(() => resolve(new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "Ok.", citations: [] }], usage: {} }))));
    })));
    const charge = vi.fn();
    const runs = Array.from({ length: 5 }, () => anthropicWebResearch([{ role: "user", content: "q?" }], { charge }));
    // A sixth concurrent run is refused before any request goes out or anything is charged.
    await expect(anthropicWebResearch([{ role: "user", content: "q?" }], { charge })).rejects.toThrow(/Rate limit/);
    expect(charge).toHaveBeenCalledTimes(5);
    release.forEach((r) => r());
    await Promise.all(runs);
    // The slots are free again; a paused turn's continuation isn't charged again.
    const replies = [
      { stop_reason: "pause_turn", content: [], usage: {} },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done.", citations: [] }], usage: {} },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(replies.shift()))));
    charge.mockClear();
    await anthropicWebResearch([{ role: "user", content: "q?" }], { charge });
    expect(charge).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("continues a paused Claude search turn and prices the searches", async () => {
    localStorage.clear();
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    localStorage.setItem("lumen.ai.model.anthropic", "claude-3-5-sonnet-latest");
    const bodies: Array<{ model: string; messages: unknown[] }> = [];
    const replies = [
      { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1" }], usage: { input_tokens: 10, output_tokens: 1, server_tool_use: { web_search_requests: 3 } } },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done.", citations: [{ type: "web_search_result_location", url: "https://a.example", title: "A", cited_text: "q" }] }], usage: { input_tokens: 5, output_tokens: 2 } },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify(replies.shift()));
    }));
    const usage: unknown[] = [];
    const blocks = await anthropicWebResearch([{ role: "user", content: "q?" }], { onUsage: (u) => usage.push(u) });
    expect(blocks.map((b) => b.text)).toEqual(["Done."]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].model).toBe("claude-sonnet-5-5"); // 3.x can't use web search
    expect(bodies[1].messages).toHaveLength(2); // the paused assistant turn is sent back
    expect((bodies[1] as unknown as { tools: Array<{ max_uses: number }> }).tools[0].max_uses).toBe(2); // 5 - 3 already used
    expect((bodies[1] as unknown as { tool_choice?: unknown }).tool_choice).toBeUndefined();
    expect(usage[0]).toMatchObject({ webSearches: 3 });
    expect(costOf({ provider: "anthropic", model: "claude-sonnet-4-5", inputTokens: 0, outputTokens: 0, webSearches: 3 })).toBeCloseTo(0.03, 6);
    vi.unstubAllGlobals();
  });

  it("keeps balanced parentheses in footnote URLs", () => {
    const c = parseCitations("[^1]: [Wiki](https://en.wikipedia.org/wiki/Rose_(plant)) — “A rose is a woody plant”\n[^2]: see https://x.example/a_(b) for more");
    expect(c.map((x) => x.url)).toEqual(["https://en.wikipedia.org/wiki/Rose_(plant)", "https://x.example/a_(b)"]);
  });

  it("reads a quote up to its own closing mark", () => {
    expect(parseCitations("  [^1]: https://indented.example/a").map((x) => x.url)).toEqual(["https://indented.example/a"]);
    expect(parseCitations("````md\n```\n[^1]: https://example.example/in-code\n```\n````\n[^2]: https://real.example/b").map((x) => x.url)).toEqual(["https://real.example/b"]);
    const c = parseCitations('[^1]: [A](https://a.example) — “The article says "quoted words" are important.”');
    expect(c[0].quote).toBe('The article says "quoted words" are important.');
  });
});
