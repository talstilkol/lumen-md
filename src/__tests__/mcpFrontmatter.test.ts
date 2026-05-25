/**
 * Tests for the MCP server's YAML-frontmatter helpers (ε.5).
 *
 * The 4 new tools added to the MCP server (`update_frontmatter`,
 * `list_tags`, `get_backlinks`, `delete_note`) all rely on the
 * tiny YAML helpers in `mcp-server/src/frontmatter.ts`. We test
 * the helpers directly rather than driving the full MCP server.
 */

import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  aggregateTags,
} from "../../mcp-server/src/frontmatter";

describe("parseFrontmatter", () => {
  it("returns empty data + offset 0 when no frontmatter is present", () => {
    const fm = parseFrontmatter("# Just a heading\n\nbody");
    expect(fm.data).toEqual({});
    expect(fm.bodyStart).toBe(0);
    expect(fm.rawHeader).toBeNull();
  });

  it("parses scalar string values", () => {
    const fm = parseFrontmatter("---\ntitle: Hello\nauthor: Tal\n---\nbody");
    expect(fm.data.title).toBe("Hello");
    expect(fm.data.author).toBe("Tal");
  });

  it("strips surrounding double-quotes from scalar values", () => {
    const fm = parseFrontmatter('---\ntitle: "He: said"\n---\n');
    expect(fm.data.title).toBe("He: said");
  });

  it("parses inline arrays into JS arrays", () => {
    const fm = parseFrontmatter("---\ntags: [a, b, c]\n---\nbody");
    expect(fm.data.tags).toEqual(["a", "b", "c"]);
  });

  it("strips quotes from quoted array entries (no embedded commas)", () => {
    const fm = parseFrontmatter('---\ntags: ["alpha", "bravo", c]\n---\n');
    expect(fm.data.tags).toEqual(["alpha", "bravo", "c"]);
  });

  it("known limitation: a quoted entry containing a comma is split — author shouldn't use commas in tags", () => {
    // We split on the comma even inside quotes. This is documented in
    // CONTRIBUTING.md ("don't put commas in tag names"). This test pins
    // the behaviour so we know if a future fix changes it.
    const fm = parseFrontmatter('---\ntags: ["a, with comma", b]\n---\n');
    expect(fm.data.tags).toEqual(['"a', 'with comma"', "b"]);
  });

  it("computes bodyStart so the caller can splice replacement headers", () => {
    const text = "---\nk: v\n---\n# Body";
    const fm = parseFrontmatter(text);
    expect(text.slice(fm.bodyStart)).toBe("# Body");
  });

  it("ignores incomplete frontmatter (no closing ---)", () => {
    const fm = parseFrontmatter("---\nk: v\n# never closed\n");
    expect(fm.data).toEqual({});
  });
});

describe("serializeFrontmatter", () => {
  it("emits the standard `---\\nkey: value\\n---\\n` shape", () => {
    const out = serializeFrontmatter({ title: "Hello" });
    expect(out).toBe("---\ntitle: Hello\n---\n");
  });

  it("quotes values containing YAML meta-chars (: # & * ? { } |)", () => {
    const out = serializeFrontmatter({ msg: "He: said yes" });
    expect(out).toBe("---\nmsg: \"He: said yes\"\n---\n");
  });

  it("emits inline arrays for array values", () => {
    const out = serializeFrontmatter({ tags: ["foo", "bar"] });
    expect(out).toBe("---\ntags: [\"foo\", \"bar\"]\n---\n");
  });

  it("round-trips: parse(serialize(data)).data === data for simple inputs", () => {
    const data = { title: "Hello", tags: ["a", "b"], rating: "5" };
    const out = serializeFrontmatter(data);
    expect(parseFrontmatter(out).data).toEqual(data);
  });
});

describe("aggregateTags", () => {
  it("counts each tag once per note (array form)", () => {
    const notes = [
      "---\ntags: [a, b]\n---\n",
      "---\ntags: [b, c]\n---\n",
    ];
    const counts = aggregateTags(notes);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(2);
    expect(counts.get("c")).toBe(1);
  });

  it("supports space-separated string-form tags too", () => {
    const counts = aggregateTags(["---\ntags: a b #c\n---\n"]);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBe(1);
  });

  it("returns an empty map when no notes have tags", () => {
    const counts = aggregateTags([
      "---\ntitle: x\n---\n",
      "no frontmatter at all",
    ]);
    expect(counts.size).toBe(0);
  });

  it("lower-cases tag values for de-duping", () => {
    const counts = aggregateTags([
      "---\ntags: [Foo, FOO, foo]\n---\n",
    ]);
    expect(counts.get("foo")).toBe(3);
  });
});
