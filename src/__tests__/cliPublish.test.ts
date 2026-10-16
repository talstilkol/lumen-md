/**
 * `lumen publish` — renders a temp folder of Markdown to a static site and
 * checks pages, the index, link rewriting and asset copying on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishSite, rewriteMarkdownLinks, pageTitle } from "../cli/publish";

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "lumen-publish-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const write = (rel: string, data: string | Uint8Array) => {
  const p = join(work, "src", rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, data);
};
const read = (rel: string) => readFileSync(join(work, "out", rel), "utf8");

describe("rewriteMarkdownLinks", () => {
  it("rewrites relative .md hrefs only", () => {
    const html =
      '<a href="a.md">a</a><a href="sub/b.markdown#x">b</a><a href="../c.md?v=1">c</a>' +
      '<a href="https://e.com/x.md">e</a><a href="/abs.md">f</a><a href="#h">g</a><a href="img.png">i</a>';
    expect(rewriteMarkdownLinks(html)).toBe(
      '<a href="a.html">a</a><a href="sub/b.html#x">b</a><a href="../c.html?v=1">c</a>' +
        '<a href="https://e.com/x.md">e</a><a href="/abs.md">f</a><a href="#h">g</a><a href="img.png">i</a>',
    );
  });
});

describe("pageTitle", () => {
  it("prefers frontmatter, then H1, then filename", () => {
    expect(pageTitle("---\ntitle: \"FM\"\n---\n# H", "x.md")).toBe("FM");
    expect(pageTitle("intro\n\n# The **Title**\n", "x.md")).toBe("The Title");
    expect(pageTitle("no heading", "dir/notes.md")).toBe("notes");
  });
});

describe("publishSite", () => {
  it("renders a folder: pages, index, rewritten links, copied assets", async () => {
    write("guide.md", "# Guide\n\nSee [the API](api/ref.md#auth) and ![logo](img/logo.png).\n\n```js\nlet a = 1;\n```");
    write("api/ref.md", "# API Reference\n\nBack to [guide](../guide.md).\n\n## Auth");
    write("img/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    write(".hidden/secret.md", "# nope");

    const res = await publishSite(join(work, "src"), join(work, "out"), { siteTitle: "Docs" });

    expect(res.pages.map((p) => p.output).sort()).toEqual(["api/ref.html", "guide.html"]);
    expect(res.assets).toEqual(["img/logo.png"]);
    expect(existsSync(join(work, "out", ".hidden"))).toBe(false);

    const guide = read("guide.html");
    expect(guide).toMatch(/^<!doctype html>/);
    expect(guide).toContain("<title>Guide — Docs</title>");
    expect(guide).toContain('href="api/ref.html#auth"');
    expect(guide).toContain('src="img/logo.png"');
    expect(guide).toContain('href="style.css"');
    expect(guide).toContain('href="index.html"');

    const ref = read("api/ref.html");
    expect(ref).toContain('href="../guide.html"');
    expect(ref).toContain('href="../style.css"');
    expect(ref).toContain('href="../index.html"');

    const index = read("index.html");
    expect(index).toContain("<title>Docs</title>");
    expect(index).toContain('<a href="api/ref.html">API Reference</a>');
    expect(index).toContain('<a href="guide.html">Guide</a>');

    expect(readFileSync(join(work, "out", "img", "logo.png"))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    );
    expect(existsSync(join(work, "out", "style.css"))).toBe(true);
  });

  it("uses a root index.md as the home page and appends the page list", async () => {
    write("index.md", "# Welcome\n\nHello <world> & co.");
    write("a.md", "# A");
    await publishSite(join(work, "src"), join(work, "out"), { siteTitle: "Site" });
    const index = read("index.html");
    expect(index).toContain("Welcome");
    expect(index).toContain('<a href="a.html">A</a>');
    expect(index).not.toContain('href="index.html">Welcome');
  });

  it("publishes a single file and skips an output dir nested in the source", async () => {
    write("one.md", "# One");
    const nestedOut = join(work, "src", "_site");
    await publishSite(join(work, "src"), nestedOut);
    const again = await publishSite(join(work, "src"), nestedOut);
    expect(again.pages.map((p) => p.source)).toEqual(["one.md"]);
    expect(again.assets).toEqual([]);

    const single = await publishSite(join(work, "src", "one.md"), join(work, "out"));
    expect(single.pages).toHaveLength(1);
    expect(read("one.html")).toContain("One");
  });

  it("refuses to publish into the source folder or one of its ancestors", async () => {
    write("a.md", "# A");
    write("style.css", "body{color:red}");
    await expect(publishSite(join(work, "src"), join(work, "src"))).rejects.toThrow(/Refusing to publish/);
    await expect(publishSite(join(work, "src"), work)).rejects.toThrow(/Refusing to publish/);
    await expect(publishSite(join(work, "src", "a.md"), join(work, "src"))).rejects.toThrow(/Refusing to publish/);
    // Source files are untouched.
    expect(readFileSync(join(work, "src", "style.css"), "utf8")).toBe("body{color:red}");
    expect(existsSync(join(work, "src", "a.html"))).toBe(false);
  });

  it("never lets a source file overwrite a generated page, the index or style.css", async () => {
    write("guide.md", "# Guide");
    write("guide.html", "<p>hand-written</p>");
    write("Notes.md", "# Notes");
    write("notes.markdown", "# Other notes");
    write("index.html", "<p>old index</p>");
    write("style.css", "body{color:red}");
    write("img.png", new Uint8Array([1, 2, 3]));
    const res = await publishSite(join(work, "src"), join(work, "out"));
    expect(read("guide.html")).toContain("Guide");
    expect(read("guide.html")).not.toContain("hand-written");
    expect(read("index.html")).toContain("lumen-site-pages");
    expect(read("style.css")).not.toContain("color:red");
    expect(res.assets).toEqual(["img.png"]);
    expect(res.skipped.map((s) => s.source).sort()).toEqual(
      ["guide.html", "index.html", "notes.markdown", "style.css"].sort(),
    );
    expect(res.pages.map((p) => p.source).sort()).toEqual(["Notes.md", "guide.md"]);
  });
});
