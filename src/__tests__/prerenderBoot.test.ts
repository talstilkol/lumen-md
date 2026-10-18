// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prerenderIntro } from "../build/prerenderWelcome";
import { BOOT_JS, BOOT_JS_HASH } from "../build/bootScript";
import { WELCOME_DOC } from "../welcome";

describe("prerendered welcome intro (C1)", () => {
  it("renders the intro only, as escaped HTML", () => {
    const html = prerenderIntro(WELCOME_DOC);
    expect(html.startsWith("<h1>Welcome to <strong>Lumen</strong>")).toBe(true);
    expect(html).toContain("<em>text and data</em>");
    expect(html).not.toContain("title:"); // frontmatter dropped
    expect(html).not.toContain("Rich text"); // stops at the first rule
  });
  it("escapes markup in the source", () => {
    expect(prerenderIntro("# a <b>\n\nx & `<i>`")).toBe("<h1>a &lt;b&gt;</h1><p>x &amp; <code>&lt;i&gt;</code></p>");
  });
});

describe("inline boot script", () => {
  it("is allowed by its hash in every page CSP", () => {
    for (const f of ["index.html", "public/_headers", "vercel.json", "docker/nginx.conf", "src-tauri/tauri.conf.json"]) {
      expect(readFileSync(f, "utf8"), f).toContain(BOOT_JS_HASH);
    }
  });
  it("never throws, even with broken storage", () => {
    expect(() => new Function("localStorage", "document", BOOT_JS)({ getItem: () => "{bad" }, {})).not.toThrow();
  });
});
