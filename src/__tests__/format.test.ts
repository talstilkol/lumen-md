import { describe, it, expect } from "vitest";
import {
  parserForLang,
  normalizeLang,
  findFencedBlockAt,
  mapCursor,
  minimalChange,
  dedent,
  reindent,
  formatCode,
  formatMarkdown,
  formatBlockAt,
  NoFormatterError,
} from "../editor/format";

describe("parserForLang", () => {
  it.each([
    ["js", "babel"],
    ["jsx", "babel"],
    ["ts", "typescript"],
    ["tsx", "typescript"],
    ["json", "json"],
    ["css", "css"],
    ["scss", "scss"],
    ["html", "html"],
    ["yaml", "yaml"],
    ["yml", "yaml"],
    ["md", "markdown"],
  ])("maps %s → %s", (lang, parser) => {
    expect(parserForLang(lang)?.parser).toBe(parser);
  });

  it("strips info-string attributes, case and live- prefix", () => {
    expect(normalizeLang("TS {1,3} title=\"a\"")).toBe("ts");
    expect(parserForLang("live-js")?.parser).toBe("babel");
    expect(parserForLang("JSON")?.parser).toBe("json");
  });

  it("returns null for unsupported or empty languages", () => {
    expect(parserForLang("python")).toBeNull();
    expect(parserForLang("")).toBeNull();
    expect(parserForLang(undefined)).toBeNull();
  });

  it("only lists plugins the parser needs", () => {
    expect(parserForLang("css")?.plugins).toEqual(["postcss"]);
    expect(parserForLang("ts")?.plugins).toContain("estree");
  });
});

describe("findFencedBlockAt", () => {
  const doc = "# T\n\n```js\nconst a=1\n```\n\ntext\n\n~~~~css\na{b:c}\n~~~~\n";
  it("finds the block containing the cursor", () => {
    const pos = doc.indexOf("const");
    const b = findFencedBlockAt(doc, pos)!;
    expect(b.lang).toBe("js");
    expect(doc.slice(b.codeFrom, b.codeTo)).toBe("const a=1");
  });
  it("treats the fence lines themselves as inside", () => {
    expect(findFencedBlockAt(doc, doc.indexOf("```js"))?.lang).toBe("js");
  });
  it("returns null outside any fence", () => {
    expect(findFencedBlockAt(doc, doc.indexOf("text"))).toBeNull();
    expect(findFencedBlockAt(doc, 0)).toBeNull();
  });
  it("finds closing fences in CRLF documents and excludes the line break", () => {
    const crlf = doc.replace(/\n/g, "\r\n");
    const b = findFencedBlockAt(crlf, crlf.indexOf("const"))!;
    expect(b.lang).toBe("js");
    expect(crlf.slice(b.codeFrom, b.codeTo)).toBe("const a=1");
    // The text after the block is outside it (the close was recognised).
    expect(findFencedBlockAt(crlf, crlf.indexOf("text"))).toBeNull();
  });
  it("handles tilde fences that need a matching-length close", () => {
    const b = findFencedBlockAt(doc, doc.indexOf("a{b"))!;
    expect(b.lang).toBe("css");
    expect(doc.slice(b.codeFrom, b.codeTo)).toBe("a{b:c}");
  });
  it("runs an unclosed fence to end of document", () => {
    const d = "x\n```ts\nlet a\n";
    const b = findFencedBlockAt(d, d.indexOf("let"))!;
    expect(b.codeTo).toBe(d.length);
  });
  it("handles an empty block", () => {
    const d = "```json\n```\n";
    const b = findFencedBlockAt(d, 2)!;
    expect(b.codeFrom).toBe(b.codeTo);
  });
});

describe("mapCursor / minimalChange / indent", () => {
  it("maps the cursor by non-whitespace count", () => {
    const before = "const  a=1";
    const after = "const a = 1;";
    // cursor after "a" (non-ws count 6)
    expect(after.slice(0, mapCursor(before, after, before.indexOf("a=") + 1))).toBe("const a");
    expect(mapCursor(before, after, 0)).toBe(0);
  });
  it("produces the smallest single replacement", () => {
    expect(minimalChange("abc", "abc")).toBeNull();
    expect(minimalChange("hello world", "hello  world")).toEqual({ from: 6, to: 6, insert: " " });
  });
  it("dedents and reindents fenced code", () => {
    expect(dedent("  a\n  b", "  ")).toBe("a\nb");
    expect(reindent("a\n\nb", "  ")).toBe("  a\n\n  b");
  });
});

describe("formatCode (lazy prettier)", () => {
  it("formats JS, TS, JSON, CSS, YAML and HTML", async () => {
    expect(await formatCode("const a={b:1}", "js")).toBe("const a = { b: 1 };\n");
    expect(await formatCode("let x:number=1", "ts")).toBe("let x: number = 1;\n");
    expect(await formatCode('{"a":1,"b":[1,2]}', "json")).toBe('{ "a": 1, "b": [1, 2] }\n');
    expect(await formatCode("a{color:red}", "css")).toBe("a {\n  color: red;\n}\n");
    expect(await formatCode("a:   1\nb:    [1,2]", "yaml")).toBe("a: 1\nb: [1, 2]\n");
    expect(await formatCode("<div><p>hi</p></div>", "html")).toContain("<p>hi</p>");
  });

  it("throws NoFormatterError for unsupported languages", async () => {
    await expect(formatCode("print(1)", "python")).rejects.toBeInstanceOf(NoFormatterError);
    await expect(formatCode("x", "python")).rejects.toMatchObject({ lang: "python" });
  });

  it("propagates parser errors for invalid code", async () => {
    await expect(formatCode("const = = ;", "js")).rejects.toThrow();
  });
});

describe("formatMarkdown", () => {
  it("normalises markdown and formats embedded code", async () => {
    const out = await formatMarkdown("#  Title\n* a\n* b\n\n```js\nconst a={b:1}\n```\n");
    expect(out).toBe("# Title\n\n- a\n- b\n\n```js\nconst a = { b: 1 };\n```\n");
  });
  it("preserves prose line wrapping", async () => {
    const src = "line one\nline two\n";
    expect(await formatMarkdown(src)).toBe(src);
  });
});

describe("formatBlockAt", () => {
  it("rewrites only the code body of the block under the cursor", async () => {
    const doc = "intro\n\n```ts\nlet x:number=1\n```\n\nouter  text\n";
    const r = await formatBlockAt(doc, doc.indexOf("number"));
    expect(r).not.toBeNull();
    const c = r!.change!;
    const next = doc.slice(0, c.from) + c.insert + doc.slice(c.to);
    expect(next).toBe("intro\n\n```ts\nlet x: number = 1;\n```\n\nouter  text\n");
    expect(next.slice(r!.cursor).trimStart().startsWith("number")).toBe(true);
  });
  it("keeps the indentation of indented fences", async () => {
    const doc = "- item\n\n  ```json\n  {\"a\":1}\n  ```\n";
    const r = await formatBlockAt(doc, doc.indexOf("\"a\""));
    const c = r!.change!;
    expect(doc.slice(0, c.from) + c.insert + doc.slice(c.to)).toBe(
      "- item\n\n  ```json\n  { \"a\": 1 }\n  ```\n",
    );
  });
  it("returns null outside a fence and throws for unknown languages", async () => {
    expect(await formatBlockAt("plain", 2)).toBeNull();
    await expect(formatBlockAt("```rust\nfn main(){}\n```", 10)).rejects.toBeInstanceOf(NoFormatterError);
  });
  it("returns a null change when already formatted", async () => {
    const r = await formatBlockAt("```js\nconst a = 1;\n```\n", 8);
    expect(r!.change).toBeNull();
  });
});
