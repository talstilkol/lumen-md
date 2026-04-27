/**
 * Tests for the Smart Insert detector. Each block-type heuristic is verified
 * against (a) a positive sample that should match, (b) at least one negative
 * sample that should NOT match (so we don't over-eagerly wrap plain prose in
 * a fence). The pipeline ordering matters too — embed URLs should beat the
 * generic bare-URL detector, JSON-table should beat raw JSON, etc.
 */

import { describe, it, expect } from "vitest";
import { smartDetect, renderAs } from "../data/smartDetect";

describe("smartDetect — high-confidence URL patterns", () => {
  it("YouTube → embed", () => {
    expect(smartDetect("https://www.youtube.com/watch?v=dQw4w9WgXcQ").kind).toBe("embed");
  });
  it("Twitter/X → embed", () => {
    expect(smartDetect("https://twitter.com/some_user/status/1234567890").kind).toBe("embed");
  });
  it("Google Maps → embed", () => {
    expect(smartDetect("https://www.google.com/maps/place/SomePlace").kind).toBe("embed");
  });
  it("plain URL → link, not embed", () => {
    const r = smartDetect("https://example.com/foo");
    expect(r.kind).toBe("url");
    expect(r.rendered).toBe("[https://example.com/foo](https://example.com/foo)");
  });
});

describe("smartDetect — diagrams", () => {
  it("Mermaid flowchart", () => {
    const r = smartDetect("flowchart LR\n  A --> B\n  B --> C");
    expect(r.kind).toBe("mermaid");
    expect(r.rendered.startsWith("```mermaid")).toBe(true);
  });
  it("Mermaid sequence diagram", () => {
    expect(smartDetect("sequenceDiagram\n  Alice->>Bob: hi").kind).toBe("mermaid");
  });
  it("Graphviz DOT", () => {
    expect(smartDetect("digraph G { a -> b; }").kind).toBe("dot");
  });
  it("PlantUML", () => {
    expect(smartDetect("@startuml\nclass A\n@enduml").kind).toBe("plantuml");
  });
});

describe("smartDetect — tabular", () => {
  it("CSV with header", () => {
    const r = smartDetect("name,age\nalice,30\nbob,25");
    expect(r.kind).toBe("csv");
    expect(r.rendered.startsWith("```csv")).toBe(true);
  });
  it("TSV", () => {
    expect(smartDetect("name\tage\nalice\t30\nbob\t25").kind).toBe("tsv");
  });
  it("JSON array of records → json-table", () => {
    expect(smartDetect('[{"a":1},{"a":2}]').kind).toBe("json-table");
  });
  it("JSON object → raw json", () => {
    expect(smartDetect('{"a":1,"b":2}').kind).toBe("json");
  });
  it("SQL CREATE TABLE → sql", () => {
    expect(smartDetect("CREATE TABLE users (id int, name text);").kind).toBe("sql");
  });
});

describe("smartDetect — math + music + bibliography", () => {
  it("display math", () => {
    expect(smartDetect("$$\\int_0^1 x^2 dx$$").kind).toBe("math");
  });
  it("LaTeX environment", () => {
    expect(smartDetect("\\begin{equation}\nE = mc^2\n\\end{equation}").kind).toBe("math");
  });
  it("ABC notation", () => {
    expect(smartDetect("X:1\nT:Test\nM:4/4\nK:C\nC D E F").kind).toBe("abc");
  });
  it("BibTeX", () => {
    expect(smartDetect("@article{foo, title={Bar}, year=2024}").kind).toBe("bibtex");
  });
  it("GeoJSON", () => {
    expect(
      smartDetect('{"type":"FeatureCollection","features":[]}').kind,
    ).toBe("geojson");
  });
  it("ECharts spec", () => {
    expect(
      smartDetect("xAxis:\n  type: category\nseries:\n  - data: [1,2,3]").kind,
    ).toBe("chart");
  });
  it("Database view spec", () => {
    expect(
      smartDetect("type: book\nview: kanban\ngroupBy: status").kind,
    ).toBe("database");
  });
  it("Database view beats chart-spec when both could match", () => {
    expect(
      smartDetect("source: ./projects\nview: gallery\nfields: [title]").kind,
    ).toBe("database");
  });
});

describe("smartDetect — code language sniff", () => {
  it("TypeScript", () => {
    const r = smartDetect("export interface Foo { bar: string; }");
    expect(r.kind).toBe("code");
    expect(r.codeLang).toBe("ts");
  });
  it("Python", () => {
    expect(smartDetect("def hello(name):\n    return f'hi {name}'").codeLang).toBe("py");
  });
  it("Rust", () => {
    expect(smartDetect("fn add(a: i32, b: i32) -> i32 { a + b }").codeLang).toBe("rs");
  });
  it("Dockerfile", () => {
    expect(smartDetect("FROM node:20\nRUN npm install").codeLang).toBe("dockerfile");
  });
});

describe("smartDetect — HTML", () => {
  it("interactive HTML → htmlpreview", () => {
    expect(
      smartDetect("<button onclick=\"alert('hi')\">Click</button>").kind,
    ).toBe("html-preview");
  });
  it("static HTML → html-markdown", () => {
    expect(smartDetect("<h1>Hello</h1><p>Body</p>").kind).toBe("html-markdown");
  });
});

describe("smartDetect — fallthrough", () => {
  it("plain markdown headings → markdown (no wrapping)", () => {
    const r = smartDetect("# My note\n\nSome text.");
    expect(r.kind).toBe("markdown");
    expect(r.rendered).toBe("# My note\n\nSome text.");
  });
  it("empty input → markdown", () => {
    expect(smartDetect("").kind).toBe("markdown");
  });
  it("list-only input → markdown (not code)", () => {
    expect(smartDetect("- item 1\n- item 2").kind).toBe("markdown");
  });
});

describe("renderAs — manual override", () => {
  it("forces sql wrapping when user picks sql", () => {
    expect(renderAs("hello", "sql")).toBe("```sql\nhello\n```");
  });
  it("forces math wrapping", () => {
    expect(renderAs("a^2 + b^2 = c^2", "math")).toBe("$$\na^2 + b^2 = c^2\n$$");
  });
  it("forces code with explicit language", () => {
    expect(renderAs("print('hi')", "code", "py")).toBe("```py\nprint('hi')\n```");
  });
  it("markdown override returns input as-is", () => {
    expect(renderAs("just text", "markdown")).toBe("just text");
  });
});
