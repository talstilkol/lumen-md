/**
 * W10.E38 (plan 6.13): a DOI fills a reference record from CrossRef, after
 * the user approves the request, through the privacy ledger; and a research
 * answer ends with a reference list of what it cites.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CROSSREF_HOST, DoiNotFoundError, lookupDoi, normalizeDoi, recordFromCrossref, type CrossrefWork } from "../citations/doi";
import { formatReference, runsToMarkdown } from "../data/citationStyles";
import { classify, blockedByPolicy } from "../ai/privacyLedger";
import { answerLang, referenceSection } from "../research/references";
import { citedBlocksToMarkdown } from "../research/agent";

// A CrossRef `message` for a journal article, written for this test in the
// shape CrossRef's REST API documents (api.crossref.org/swagger-ui): synthetic, not a fetched record.
const WORK: CrossrefWork = {
  DOI: "10.5555/example.2024.001",
  type: "journal-article",
  title: ["Hebrew <i>diacritics</i> in the browser"],
  "container-title": ["Journal of Example Studies"],
  author: [{ given: "Noa", family: "Levi" }, { given: "Dan", family: "Cohen" }],
  issued: { "date-parts": [[2024, 3, 1]] },
  volume: "12",
  issue: "2",
  page: "101-118",
  publisher: "Example Press",
};

describe("normalizeDoi", () => {
  it("accepts the ways people paste a DOI, refuses what is not one", () => {
    expect(normalizeDoi("10.1000/xyz123")).toBe("10.1000/xyz123");
    expect(normalizeDoi("  doi:10.1000/xyz123. ")).toBe("10.1000/xyz123");
    expect(normalizeDoi("https://doi.org/10.1000/a%2Fb")).toBe("10.1000/a/b");
    expect(normalizeDoi("http://dx.doi.org/10.1038/nature14539")).toBe("10.1038/nature14539");
    expect(normalizeDoi("hello")).toBeNull();
    expect(normalizeDoi("10.12/x")).toBeNull();
  });
});

describe("recordFromCrossref", () => {
  it("fills the record the APA / Chicago / MLA formatter reads", () => {
    const r = recordFromCrossref(WORK);
    expect(r).toEqual({
      type: "article",
      authors: [{ family: "Levi", given: "Noa" }, { family: "Cohen", given: "Dan" }],
      title: "Hebrew diacritics in the browser",
      year: "2024",
      container: "Journal of Example Studies",
      publisher: "Example Press",
      volume: "12",
      issue: "2",
      pages: "101–118",
      doi: "10.5555/example.2024.001",
    });
    const apa = runsToMarkdown(formatReference(r, "apa", "en"));
    expect(apa).toContain("Levi, N., & Cohen, D. (2024).");
    expect(apa).toContain("*Journal of Example Studies*");
    expect(apa).toContain("10.5555/example.2024.001");
    expect(recordFromCrossref({ type: "book-chapter", title: ["x"], editor: [{ name: "Unesco" }] })).toMatchObject({ type: "chapter", editors: [{ family: "Unesco" }] });
    expect(recordFromCrossref({ type: "something-new", title: ["y"], "published-online": { "date-parts": [[2021]] } })).toMatchObject({ type: "misc", year: "2021" });
  });
});

describe("lookupDoi", () => {
  const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ""}`;

  it("asks first; a declined request sends nothing", async () => {
    const fetch = vi.fn();
    const confirm = vi.fn(async () => false);
    expect(await lookupDoi("10.5555/example.2024.001", { confirm, t, fetch })).toBeNull();
    expect(confirm.mock.calls[0][0].message).toContain("10.5555/example.2024.001");
    expect(confirm.mock.calls[0][0].message).toContain(CROSSREF_HOST);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("approved: only the DOI goes to CrossRef, and the record comes back filled", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: "ok", message: WORK }), { status: 200 }));
    const r = await lookupDoi("doi:10.5555/example.2024.001", { confirm: async () => true, t, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe("https://api.crossref.org/works/10.5555%2Fexample.2024.001");
    expect(r?.title).toBe("Hebrew diacritics in the browser");
    const missing = vi.fn(async () => new Response("Resource not found.", { status: 404 }));
    await expect(lookupDoi("10.5555/none", { confirm: async () => true, t, fetch: missing as unknown as typeof globalThis.fetch })).rejects.toBeInstanceOf(DoiNotFoundError);
    await expect(lookupDoi("not a doi", { confirm: async () => true, t, fetch })).rejects.toThrow(/cite\.doi\.invalid/);
  });

  it("goes through the privacy ledger as research, blocked by local-only, and the CSP allows it", () => {
    const c = classify("https://api.crossref.org/works/10.5555%2Fx");
    expect(c).toMatchObject({ host: "api.crossref.org", category: "research" });
    expect(blockedByPolicy("research", "local-only")).toBe(true);
    const policy = JSON.parse(readFileSync(join(__dirname, "../../security/policy.json"), "utf8"));
    expect(JSON.stringify(policy)).toContain("https://api.crossref.org");
    expect(readFileSync(join(__dirname, "../../index.html"), "utf8")).toContain("https://api.crossref.org");
  });
});

describe("references at the end of a research answer", () => {
  it("one line per cited page, once, in the answer's language", () => {
    const src = [
      { title: "Hebrew typesetting", url: "https://example.org/a" },
      { title: "Hebrew typesetting", url: "https://example.org/a" },
      { title: "", url: "https://www.example.com/b" },
      { title: "A note", url: "[[note]]" },
    ];
    const en = referenceSection(src, "apa", "en");
    expect(en[0]).toBe("## References");
    expect(en.filter((l) => l.startsWith("- "))).toHaveLength(2);
    expect(en.join("\n")).toContain("https://example.org/a");
    expect(referenceSection(src, "apa", "he")[0]).toBe("## מקורות");
    expect(referenceSection([], "apa", "en")).toEqual([]);
    expect(answerLang("מה ההבדל בין ניקוד לטעמים?")).toBe("he");
    expect(answerLang("What is niqqud?")).toBe("en");
  });

  it("the Claude route's note carries the list", () => {
    const { markdown } = citedBlocksToMarkdown("What is niqqud?", [
      { text: "Niqqud marks vowels in Hebrew script. ", citations: [{ url: "https://example.org/niqqud", title: "Niqqud", quote: "marks vowels" }] },
    ]);
    expect(markdown).toMatch(/## References\n\n- .*https:\/\/example\.org\/niqqud/);
    expect(markdown.indexOf("## References")).toBeLessThan(markdown.indexOf("[^1]:"));
  });
});
