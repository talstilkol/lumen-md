/**
 * insertMenu — tests for the slash menu data model and filter logic.
 */
import { describe, it, expect } from "vitest";

/** Extracted from src/editor/insertMenu.ts */
interface MenuEntry {
  id: string;
  label: string;
  hint: string;
  group: string;
  template: string;
}

const ENTRIES: MenuEntry[] = [
  { id: "csv", label: "CSV table", hint: "Sortable table + auto chart", group: "Data", template: "```csv\n```" },
  { id: "mermaid", label: "Mermaid diagram", hint: "Flowchart / sequence / gantt", group: "Diagrams", template: "```mermaid\n```" },
  { id: "chart", label: "ECharts chart", hint: "Explicit YAML/JSON spec", group: "Data", template: "```chart\n```" },
  { id: "math", label: "Math block", hint: "Display KaTeX", group: "Math & references", template: "$$\n$$" },
  { id: "yt", label: "YouTube", hint: "Video / Short", group: "Social", template: '```embed\nhttps://youtube.com\n```' },
  { id: "graphviz", label: "Graphviz / DOT", hint: "WASM-rendered locally", group: "Diagrams", template: "```dot\n```" },
  { id: "plantuml", label: "PlantUML", hint: "Rendered via kroki.io", group: "Diagrams", template: "```plantuml\n```" },
  { id: "live-js", label: "Live JavaScript", hint: "Sandbox + console output", group: "Media", template: "```live-js\n```" },
];

function filtered(query: string): MenuEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return ENTRIES;
  return ENTRIES.filter((e) =>
    `${e.label} ${e.hint} ${e.group} ${e.id}`.toLowerCase().includes(q),
  );
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

describe("filtered()", () => {
  it("returns all entries for empty query", () => {
    expect(filtered("")).toHaveLength(ENTRIES.length);
    expect(filtered("   ")).toHaveLength(ENTRIES.length);
  });

  it("filters by label", () => {
    const results = filtered("mermaid");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("mermaid");
  });

  it("filters by hint", () => {
    const results = filtered("KaTeX");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("math");
  });

  it("filters by group", () => {
    const results = filtered("Diagrams");
    expect(results.every((r) => r.group === "Diagrams")).toBe(true);
    expect(results).toHaveLength(3);
  });

  it("filters by id", () => {
    const results = filtered("csv");
    expect(results.some((r) => r.id === "csv")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(filtered("MERMAID")).toHaveLength(1);
    expect(filtered("mErMaId")).toHaveLength(1);
  });

  it("returns empty for no match", () => {
    expect(filtered("xyznonexistent")).toHaveLength(0);
  });

  it("matches partial text", () => {
    expect(filtered("flow").some((r) => r.id === "mermaid")).toBe(true);
  });
});

describe("escape()", () => {
  it("escapes HTML entities", () => {
    expect(escape("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
    );
  });

  it("escapes ampersand", () => {
    expect(escape("a & b")).toBe("a &amp; b");
  });

  it("escapes double quotes", () => {
    expect(escape('He said "hello"')).toBe("He said &quot;hello&quot;");
  });

  it("passes safe text through", () => {
    expect(escape("Hello World")).toBe("Hello World");
  });

  it("handles empty string", () => {
    expect(escape("")).toBe("");
  });
});

describe("ENTRIES data integrity", () => {
  it("all entries have unique IDs", () => {
    const ids = ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all entries have non-empty labels", () => {
    for (const e of ENTRIES) {
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it("all entries have non-empty templates", () => {
    for (const e of ENTRIES) {
      expect(e.template.length).toBeGreaterThan(0);
    }
  });

  it("all entries have a group", () => {
    for (const e of ENTRIES) {
      expect(e.group.length).toBeGreaterThan(0);
    }
  });
});
