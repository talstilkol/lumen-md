/** Context packer (D3) and model router (D4). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CONTEXT_BUDGET, getAiMode, packContext, setAiMode } from "../ai/contextPacker";
import { chat, routeOptions, setActiveProvider } from "../ai/llm";
import { estimateTokens } from "../ai/usage";

const section = (title: string, body: string, n = 40) => `## ${title}\n\n${Array.from({ length: n }, () => body).join(" ")}\n`;

describe("packContext", () => {
  it("passes short inputs through unchanged", () => {
    const docs = [{ path: "a.md", content: "# A\n\nshort" }];
    expect(packContext("anything", docs, 1000)).toEqual([{ path: "a.md", text: "# A\n\nshort", trimmed: false }]);
  });

  it("keeps the chunks relevant to the question within the budget, in order, with an outline", () => {
    const content = [
      "# Garden notes\n\nAbout my garden.\n",
      section("Tomatoes", "tomato plants need sun and water daily"),
      section("Invoices", "billing invoice payment due amount"),
      section("Roses", "rose pruning in early spring"),
      section("Taxes", "tax return deadline accountant"),
    ].join("\n");
    const budget = 300;
    const [packed] = packContext("when should I prune the roses?", [{ path: "garden.md", content }], budget);
    expect(packed.trimmed).toBe(true);
    expect(packed.text).toContain("Outline: # Garden notes · ## Tomatoes · ## Invoices · ## Roses · ## Taxes");
    expect(packed.text).toContain("rose pruning");
    expect(packed.text).not.toContain("tax return");
    expect(packed.text).toContain("[…]");
    expect(estimateTokens(packed.text)).toBeLessThanOrEqual(budget);
    expect(estimateTokens(content)).toBeGreaterThan(budget * 3);
  });

  it("cuts a single oversized relevant section instead of sending it whole", () => {
    const content = section("Only", "lifetimes and borrowing rules explained at length", 200);
    const [p] = packContext("borrowing rules", [{ path: "x.md", content }], 200);
    expect(p.trimmed).toBe(true);
    expect(estimateTokens(p.text)).toBeLessThanOrEqual(200);
    expect(p.text).toContain("borrowing rules");
  });

  it("keeps something of every retrieved note, even with no shared words", () => {
    const a = { path: "a.md", content: section("Rust", "ownership borrow checker lifetimes", 80) };
    const b = { path: "b.md", content: section("Memory", "allocation arenas regions", 80) }; // a semantic hit
    const packed = packContext("borrow checker lifetimes", [a, b], 600);
    expect(packed[1].text).toContain("arenas");
    expect(estimateTokens(packed.map((p) => p.text).join(""))).toBeLessThanOrEqual(600);
  });

  it("spreads the budget across documents by relevance", () => {
    const a = { path: "a.md", content: section("Rust", "ownership borrow checker lifetimes", 80) };
    const b = { path: "b.md", content: section("Cooking", "pasta sauce garlic onion", 80) };
    const packed = packContext("borrow checker lifetimes", [a, b], 400);
    expect(packed[0].text).toContain("borrow checker");
    // The unrelated note gets at most a fair share; the relevant one gets the rest.
    expect(estimateTokens(packed[1].text)).toBeLessThanOrEqual(200 + 20);
    expect(estimateTokens(packed[0].text)).toBeGreaterThan(estimateTokens(packed[1].text));
  });

  it("has a budget per mode and remembers the mode", () => {
    localStorage.clear();
    expect(getAiMode()).toBe("balanced");
    setAiMode("economy");
    expect(getAiMode()).toBe("economy");
    expect(CONTEXT_BUDGET.economy).toBeLessThan(CONTEXT_BUDGET.balanced);
    setAiMode("balanced");
    expect(localStorage.getItem("lumen.ai.mode")).toBeNull();
  });
});

describe("model router", () => {
  it("routes light tasks (and everything in economy) to the small model unless pinned", () => {
    expect(routeOptions("anthropic", { tier: "light" }, "balanced").model).toBe("claude-haiku-4-5");
    expect(routeOptions("anthropic", {}, "balanced").model).toBeUndefined();
    expect(routeOptions("anthropic", {}, "economy").model).toBe("claude-haiku-4-5");
    expect(routeOptions("anthropic", { tier: "light" }, "quality").model).toBeUndefined();
    expect(routeOptions("anthropic", { tier: "light", model: "pinned" }, "economy").model).toBe("pinned");
    expect(routeOptions("ollama", { tier: "light" }, "economy").model).toBeUndefined();
  });

  describe("through chat()", () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.unstubAllGlobals());
    it("sends a light request to the small model", async () => {
      setActiveProvider("anthropic");
      localStorage.setItem("lumen.ai.key.anthropic", "a-key");
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await chat([{ role: "user", content: "title?" }], { tier: "light" });
      await chat([{ role: "user", content: "essay" }]);
      const models = fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).model);
      expect(models).toEqual(["claude-haiku-4-5", "claude-3-5-sonnet-latest"]);
    });
  });
});
