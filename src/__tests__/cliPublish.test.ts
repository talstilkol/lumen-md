/**
 * `lumen publish` — renders a temp folder of Markdown to a static site and
 * checks pages, the index, link rewriting and asset copying on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
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

  it("points links to the root index (any casing) at the lowercase index.html", () => {
    expect(rewriteMarkdownLinks('<a href="INDEX.md">h</a>', "about.html")).toBe('<a href="index.html">h</a>');
    expect(rewriteMarkdownLinks('<a href="../Index.markdown#top">h</a>', "docs/a.html")).toBe(
      '<a href="../index.html#top">h</a>',
    );
    // A nested INDEX.md is not the root index: keep its own name.
    expect(rewriteMarkdownLinks('<a href="INDEX.md">h</a>', "docs/a.html")).toBe('<a href="INDEX.html">h</a>');
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

  it("skips assets under a folder named like a generated page instead of aborting (ENOTDIR)", async () => {
    write("guide.md", "# Guide");
    write("guide.html/diagram.png", new Uint8Array([1, 2]));
    write("ok/pic.png", new Uint8Array([3]));
    const res = await publishSite(join(work, "src"), join(work, "out"));
    expect(read("guide.html")).toContain("Guide");
    expect(res.assets).toEqual(["ok/pic.png"]);
    expect(res.skipped).toEqual([
      expect.objectContaining({ source: "guide.html/diagram.png", reason: expect.stringContaining("guide.md") }),
    ]);
  });

  it("writes a root INDEX.md / Index.md as lowercase index.html", async () => {
    write("Index.md", "# Home page");
    write("a.md", "# A");
    const res = await publishSite(join(work, "src"), join(work, "out"), { siteTitle: "Site" });
    expect(res.pages.find((p) => p.source === "Index.md")?.output).toBe("index.html");
    expect(read("index.html")).toContain("Home page");
    expect(read("index.html")).toContain('<a href="a.html">A</a>');
    expect(existsSync(join(work, "out", "Index.html")) && !existsSync(join(work, "out", "index.html"))).toBe(false);
  });
});

describe("republishing into the same folder", () => {
  it("removes what the previous publish wrote, so outputs can change shape", async () => {
    write("guide.html/image.png", new Uint8Array([1, 2, 3]));
    write("old.md", "# Old");
    await publishSite(join(work, "src"), join(work, "out"));
    expect(existsSync(join(work, "out", "guide.html", "image.png"))).toBe(true);
    // Unrelated files the user put in the output folder stay.
    writeFileSync(join(work, "out", "CNAME"), "docs.example.com");

    rmSync(join(work, "src"), { recursive: true });
    write("guide.md", "# Guide");
    const res = await publishSite(join(work, "src"), join(work, "out"));
    expect(res.skipped).toEqual([]);
    expect(read("guide.html")).toContain("Guide");
    expect(existsSync(join(work, "out", "old.html"))).toBe(false);
    expect(existsSync(join(work, "out", "CNAME"))).toBe(true);
  });

  it("never deletes outside the output folder via a tampered manifest", async () => {
    write("a.md", "# A");
    writeFileSync(join(work, "keep.txt"), "x");
    mkdirSync(join(work, "out"), { recursive: true });
    writeFileSync(join(work, "out", ".lumen-publish.json"), JSON.stringify({ files: ["../keep.txt"] }));
    await publishSite(join(work, "src"), join(work, "out"));
    expect(existsSync(join(work, "keep.txt"))).toBe(true);
  });
});

describe("republish cleanup and symlinks", () => {
  it("doesn't follow a symlinked folder out of the output directory", async () => {
    write("assets/logo.png", new Uint8Array([1]));
    await publishSite(join(work, "src"), join(work, "out"));
    // Replace out/assets with a link to an outside folder holding a same-named file.
    mkdirSync(join(work, "elsewhere"));
    writeFileSync(join(work, "elsewhere", "logo.png"), "precious");
    rmSync(join(work, "out", "assets"), { recursive: true });
    symlinkSync(join(work, "elsewhere"), join(work, "out", "assets"), "dir");
    rmSync(join(work, "src", "assets"), { recursive: true });
    await publishSite(join(work, "src"), join(work, "out"));
    expect(readFileSync(join(work, "elsewhere", "logo.png"), "utf8")).toBe("precious");
  });
});

describe("symlinks at generated paths", () => {
  it("replaces a symlinked output file instead of writing through it", async () => {
    write("a.md", "# A");
    await publishSite(join(work, "src"), join(work, "out"));
    writeFileSync(join(work, "outside.css"), "precious");
    rmSync(join(work, "out", "style.css"));
    symlinkSync(join(work, "outside.css"), join(work, "out", "style.css"));
    await publishSite(join(work, "src"), join(work, "out"));
    expect(readFileSync(join(work, "outside.css"), "utf8")).toBe("precious");
    expect(read("style.css")).not.toBe("precious");
  });

  it("refuses to write through a symlinked output folder", async () => {
    write("docs/a.md", "# A");
    mkdirSync(join(work, "elsewhere"));
    mkdirSync(join(work, "out"));
    symlinkSync(join(work, "elsewhere"), join(work, "out", "docs"), "dir");
    await expect(publishSite(join(work, "src"), join(work, "out"))).rejects.toThrow(/symlink/);
    expect(existsSync(join(work, "elsewhere", "a.html"))).toBe(false);
  });
});

describe("single-file publish", () => {
  it("copies the local files the page references", async () => {
    write("README.md", "# Readme\n\n![logo](logo.png)\n\n[guide](docs/My%20Guide.pdf) [ext](https://x.y/a.png) [up](../secret.txt)");
    write("logo.png", new Uint8Array([1, 2]));
    write("docs/My Guide.pdf", "pdf");
    write("unused.png", new Uint8Array([3]));
    writeFileSync(join(work, "secret.txt"), "s");
    const res = await publishSite(join(work, "src", "README.md"), join(work, "out"));
    expect(res.assets.sort()).toEqual(["docs/My Guide.pdf", "logo.png"]);
    expect(existsSync(join(work, "out", "unused.png"))).toBe(false);
    expect(existsSync(join(work, "out", "secret.txt"))).toBe(false);
  });
});

describe("single-file publish and symlinks", () => {
  it("doesn't copy a referenced asset that is (or sits under) a symlink", async () => {
    writeFileSync(join(work, "secret.txt"), "secret");
    mkdirSync(join(work, "outsideDir"));
    writeFileSync(join(work, "outsideDir", "img.png"), "secret2");
    write("README.md", "![a](logo.png) ![b](linked/img.png) ![c](ok.png)");
    write("ok.png", new Uint8Array([1]));
    symlinkSync(join(work, "secret.txt"), join(work, "src", "logo.png"));
    symlinkSync(join(work, "outsideDir"), join(work, "src", "linked"), "dir");
    const res = await publishSite(join(work, "src", "README.md"), join(work, "out"));
    expect(res.assets).toEqual(["ok.png"]);
    expect(existsSync(join(work, "out", "logo.png"))).toBe(false);
  });
});

describe("canonical paths", () => {
  it("refuses an output folder reached through a symlink to the source", async () => {
    write("a.md", "# A");
    symlinkSync(join(work, "src"), join(work, "src-link"), "dir");
    // Input via the link, --out the real source folder.
    await expect(publishSite(join(work, "src-link"), join(work, "src"))).rejects.toThrow(/Refusing to publish/);
    // --out itself a symlink pointing back into the source.
    symlinkSync(join(work, "src"), join(work, "out-link"), "dir");
    await expect(publishSite(join(work, "src"), join(work, "out-link"))).rejects.toThrow(/symlink/);
    expect(existsSync(join(work, "src", "style.css"))).toBe(false);
  });

  it("still publishes from a symlinked input into a separate folder", async () => {
    write("a.md", "# A");
    symlinkSync(join(work, "src"), join(work, "src-link"), "dir");
    const res = await publishSite(join(work, "src-link"), join(work, "out"));
    expect(res.pages.map((p) => p.output)).toEqual(["a.html"]);
  });
});

describe("single-file publish follows page links", () => {
  it("publishes the Markdown pages a single file links to (transitively)", async () => {
    write("README.md", "# Home\n\nSee [the guide](docs/guide.md#install) and [ref].\n\n[ref]: notes.md");
    write("docs/guide.md", "# Guide\n\n![shot](img/a.png) back to [home](../README.md) and [faq](faq.md)");
    write("docs/faq.md", "# FAQ");
    write("docs/img/a.png", new Uint8Array([1]));
    write("notes.md", "# Notes");
    write("unlinked.md", "# Not linked");
    const res = await publishSite(join(work, "src", "README.md"), join(work, "out"));
    expect(res.pages.map((p) => p.output).sort()).toEqual(["README.html", "docs/faq.html", "docs/guide.html", "notes.html"]);
    expect(res.assets).toEqual(["docs/img/a.png"]);
    expect(existsSync(join(work, "out", "unlinked.html"))).toBe(false);
    expect(read("README.html")).toContain('href="docs/guide.html#install"');
  });

  it("does not follow links outside the source folder", async () => {
    writeFileSync(join(work, "outside.md"), "# Outside");
    write("README.md", "[x](../outside.md)");
    const res = await publishSite(join(work, "src", "README.md"), join(work, "out"));
    expect(res.pages.map((p) => p.output)).toEqual(["README.html"]);
  });
});

describe("page-list links", () => {
  it("percent-encode URL delimiters in file names", async () => {
    write("FAQ #1.md", "# FAQ");
    write("what?.md", "# Q");
    await publishSite(join(work, "src"), join(work, "out"));
    expect(read("index.html")).toContain('href="FAQ%20%231.html"');
    expect(read("index.html")).toContain('href="what%3F.html"');
  });
});
