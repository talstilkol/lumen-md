/** T34 — web clipper, library and research that stays on the device. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { clipFileName, clipFromHtml, clipUrl, isLibraryPath, readableHtml } from "../research/clipper";

const page = `<!doctype html><html><head><title>Site — Article</title><meta property="og:title" content="מאמר על השקה"></head>
<body><nav><a href="/">Home</a> Menu</nav><header>Banner</header>
<article><h1>מאמר על השקה</h1><p>ההשקה נדחתה ליום שלישי.</p><p>Budget <b>unchanged</b>.</p><script>evil()</script></article>
<footer>© footer</footer><aside class="ads">Buy now</aside></body></html>`;

describe("clipper", () => {
  it("keeps the article and drops menus, ads, scripts", () => {
    const r = readableHtml(page);
    expect(r.title).toBe("מאמר על השקה");
    expect(r.html).toContain("ההשקה נדחתה");
    expect(r.html).not.toMatch(/Menu|Banner|footer|Buy now|evil/);
  });

  it("builds a note with source, clip date and tag", () => {
    const c = clipFromHtml(page, "https://example.com/a", new Date("2026-10-18T00:00:00Z"));
    expect(c.markdown).toMatch(/^---\ntitle: "מאמר על השקה"\nsource: "https:\/\/example.com\/a"\nclipped: 2026-10-18\ntags: \[clip\]\n---/);
    expect(c.markdown).toContain("**unchanged**");
  });

  it("uses the research extractor when available, else fetches", async () => {
    // Both routes are third-party traffic: allowed outside local-only (plan 2.4; local-only is tested in ledgerComplete.test.ts).
    localStorage.setItem("lumen.ai.policy", "local-first");
    const c = await clipUrl("https://x.test/p", { extract: async () => ({ title: "T", text: "Body text", finalUrl: "https://x.test/p2" }) });
    expect(c.source).toBe("https://x.test/p2");
    expect(c.markdown).toContain("Body text");
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(page, { status: 200 }));
    const d = await clipUrl("https://x.test/q", { extract: async () => ({ error: "blocked-url" }) });
    localStorage.removeItem("lumen.ai.policy");
    expect(d.title).toBe("מאמר על השקה");
    f.mockRestore();
  });

  it("keeps a header inside the article (headline, byline, lead)", () => {
    const html = `<body><header>Site chrome</header><article><header><h1>Headline</h1><p class="byline">By Dana</p><p>The lead.</p></header><p>Body.</p></article></body>`;
    const r = readableHtml(html);
    expect(r.html).toContain("By Dana");
    expect(r.html).toContain("The lead.");
    expect(r.html).not.toContain("Site chrome");
  });

  it("resolves relative links and images against the clipped page", () => {
    const html = `<article><p><a href="/next">next</a> <a href="#s2">s2</a> <img src="../photo.jpg" srcset="a.jpg 1x, /b.jpg 2x"></p></article>`;
    const c = clipFromHtml(html, "https://news.example/2026/10/story.html");
    expect(c.markdown).toContain("(https://news.example/next)");
    expect(c.markdown).toContain("(https://news.example/2026/10/story.html#s2)");
    expect(c.markdown).toContain("https://news.example/2026/photo.jpg");
    expect(readableHtml(html, "https://news.example/2026/10/story.html").html).toContain("https://news.example/b.jpg 2x");
    // No usable source (clipboard without an address): left as is.
    expect(clipFromHtml(html, "clipboard").markdown).toContain("(/next)");
  });

  it("doesn't try a direct fetch the CSP would block; says what is needed", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", "default-src 'self'; connect-src 'self' https://api.openai.com");
    document.head.appendChild(meta);
    const f = vi.spyOn(globalThis, "fetch");
    localStorage.setItem("lumen.ai.policy", "local-first");
    try {
      await expect(clipUrl("https://blog.example/post")).rejects.toMatchObject({ name: "ResearchUnavailableError" });
      await expect(clipUrl("https://blog.example/post", { extract: async () => ({ error: "blocked-url" }) })).rejects.toThrow("blocked-url");
      expect(f).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem("lumen.ai.policy");
      f.mockRestore();
      meta.remove();
    }
  });

  it("safe file names and library paths", () => {
    expect(clipFileName('a/b: "c"?')).toBe("a b c.md");
    expect(isLibraryPath("ספרייה/x.md")).toBe(true);
    expect(isLibraryPath("Library/x.md")).toBe(true);
    expect(isLibraryPath("notes/x.md")).toBe(false);
  });
});

describe("research under local-only", () => {
  beforeEach(() => localStorage.clear());

  it("never goes online and answers from the library", async () => {
    localStorage.setItem("lumen.ai.policy", "local-only");
    vi.doMock("../ai/semanticSearch", () => ({ searchHybrid: async () => [{ path: "ספרייה/השקה.md", score: 1, snippet: "ההשקה נדחתה ליום שלישי." }, { path: "notes/other.md", score: 0.9, snippet: "x" }] }));
    vi.doMock("../storage/workspace", async (o) => ({ ...(await o<object>()), readWorkspaceFile: async () => "# השקה\nההשקה נדחתה ליום שלישי.\n" }));
    vi.doMock("../ai/llm", async (o) => ({ ...(await o<object>()), chat: async () => 'ההשקה נדחתה [1] "ההשקה נדחתה ליום שלישי".' }));
    const f = vi.spyOn(globalThis, "fetch");
    vi.resetModules();
    const { runResearch, researchGoesOnline } = await import("../research/agent");
    expect(researchGoesOnline()).toBe(false);
    const r = await runResearch({ question: "מתי ההשקה?", deps: { settings: { provider: "claude", key: "" } } });
    expect(r.route).toBe("library");
    expect(r.unverified).toBe(0);
    expect(r.markdown).toContain("[[השקה]]");
    expect(r.markdown).not.toContain("other");
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
});

describe("library research checks", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("lumen.ai.policy", "local-only");
  });

  async function research(answer: string, hits?: Array<{ path: string; score: number; snippet: string }>) {
    const all = hits ?? [{ path: "Library/launch.md", score: 1, snippet: "The launch moved to Tuesday." }];
    vi.doMock("../ai/semanticSearch", () => ({
      searchHybrid: async (_q: string, k: number, o?: { filter?: (p: string) => boolean }) =>
        all.filter((h) => !o?.filter || o.filter(h.path)).slice(0, k),
    }));
    vi.doMock("../storage/workspace", async (o) => ({ ...(await o<object>()), readWorkspaceFile: async () => "# Launch\nThe launch moved to Tuesday.\n" }));
    vi.doMock("../ai/llm", async (o) => ({ ...(await o<object>()), chat: async () => answer }));
    vi.resetModules();
    const { runResearch } = await import("../research/agent");
    return runResearch({ question: "When is the launch?", deps: { settings: { provider: "claude", key: "" } } });
  }

  it("scopes retrieval to the library before the result limit", async () => {
    const notes = Array.from({ length: 45 }, (_, i) => ({ path: `notes/n${i}.md`, score: 2, snippet: "launch" }));
    const r = await research('Tuesday [1] "The launch moved to Tuesday".', [...notes, { path: "Library/launch.md", score: 1, snippet: "x" }]);
    expect(r.sources).toBe(1);
    expect(r.unverified).toBe(0);
  });

  it("an answer without citations counts as unsupported", async () => {
    const r = await research("The launch is on Tuesday.");
    expect(r.unverified).toBe(1);
    expect(r.markdown).toContain("cites no library page");
  });

  it("marks each failed citation in the saved report", async () => {
    const r = await research('Tuesday [1] "The launch moved to Tuesday". Budget doubled [1] "Budget doubled".');
    expect(r.unverified).toBe(1);
    expect(r.markdown).toContain('[1] "The launch moved to Tuesday".');
    expect(r.markdown).toContain('[1] "Budget doubled" ⚠️ *quote not found in the page*');
    expect(r.markdown).not.toContain('Tuesday" ⚠️');
  });
});
