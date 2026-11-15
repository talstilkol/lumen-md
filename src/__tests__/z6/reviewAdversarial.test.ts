/**
 * Review Z6-M1, Z6-M2 and Z6-L1 (#924): the plugin review's CSS, licence and
 * minified-bundle checks against inputs written to get past them. All the
 * samples are synthetic (written here). The CSS ones are written with
 * String.raw, so each backslash below is one backslash in the stylesheet.
 */
import { describe, expect, it } from "vitest";
import { cssFindings, isOpenSourceLicense, minifiedOnly, reviewPluginVersion } from "../../plugins/runtime/review";

const remote = (css: string) => cssFindings(css).filter((f) => f.rule === "css-remote-url" || f.rule === "css-import");

describe("CSS: every remote load is found (Z6-M1)", () => {
  const bad: Array<[string, string]> = [
    ["quoted url with ')'", String.raw`a{background:url("https://evil.example/a)b.png")}`],
    ["quoted url with the other quote", String.raw`a{background:url('https://evil.example/it"s.png')}`],
    ["quoted url with ';' and '}'", String.raw`a{background:url("https://evil.example/a;b}c.png")}`],
    ["tab escape inside the scheme", String.raw`a{background:url("ht\9 tps://evil.example/x")}`],
    ["newline escape inside the scheme", String.raw`a{background:url("ht\a tps://evil.example/x")}`],
    ["tab escape in an unquoted url", String.raw`a{background:url(ht\9 tps://evil.example/x)}`],
    ["'/<tab>/host'", String.raw`a{background:url("/\9/evil.example/x")}`],
    ["'/<newline>/host', unquoted", String.raw`a{background:url(/\a/evil.example/x)}`],
    ["backslashes for slashes", String.raw`a{background:url("\\\\evil.example/x")}`],
    ["escaped slashes", String.raw`a{background:url(https:\2f\2f evil.example/x)}`],
    ["a leading C0 control", String.raw`a{background:url("\1 https://evil.example/x")}`],
    ["leading spaces then //", `a{background:url("   //evil.example/x")}`],
    ["a line continuation in the string", 'a{background:url("htt\\\nps://evil.example/x")}'],
    ["spaces inside url( )", `a{background:url(   "https://evil.example/x"   )}`],
    ["upper-case URL(", `a{background:URL(https://evil.example/x)}`],
    ["escaped function name", String.raw`a{background:\75 rl(https://evil.example/x)}`],
    ["escaped function name, quoted", String.raw`a{background:u\72l("https://evil.example/x")}`],
    ["protocol-relative", `a{background:url(//evil.example/x)}`],
    ["image-set string", `a{background-image:image-set("https://evil.example/a.png" 1x)}`],
    ["image-set, second string", `a{background-image:image-set("a.png" 1x, "https://evil.example/b.png" 2x)}`],
    ["-webkit-image-set with url()", `a{background-image:-webkit-image-set(url(https://evil.example/a.png) 1x)}`],
    ["src() string", `@font-face{font-family:x;src("https://evil.example/f.woff2")}`],
    ["image() string", `a{background-image:image("https://evil.example/a.png")}`],
    ["url() nested in another function", `a{background-image:cross-fade(url(https://evil.example/a.png), url(b.png))}`],
    ["blob: URL of another origin", `a{background:url("blob:https://evil.example/0b1c")}`],
    ["javascript: URL", `a{background:url("javascript:alert(1)")}`],
    ["@import url()", `@import url(theme.css);`],
    ["@IMPORT upper case", `@IMPORT "theme.css";`],
    ["@import escaped", String.raw`@\69 mport "theme.css";`],
    ["after a comment holding a quote", `/* it's */ a{background:url(https://evil.example/x)}`],
  ];
  it.each(bad)("%s", (_name: string, css: string) => {
    expect(remote(css).length, css).toBeGreaterThan(0);
  });

  const good: Array<[string, string]> = [
    ["a data: URL holding an http URL", `a{background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>")}`],
    ["a string that is not loaded", `a::after{content:"url(https://evil.example/x)"}`],
    ["an attribute selector", `a[href^="https://evil.example"]{color:red}`],
    ["a comment", `/* url(https://evil.example/x) @import "x"; */ a{}`],
    ["relative, fragment and spaces", `a{background:url(#g)} b{background:url(./a.png)} c{background:url("fonts/a b.woff2")}`],
    ["local() and format()", `@font-face{font-family:x;src:local("Arial"), url(a.woff2) format("woff2")}`],
    ["a hash token, not a function", `#url(a){color:red}`],
  ];
  it.each(good)("allowed: %s", (_name: string, css: string) => {
    expect(remote(css), css).toEqual([]);
  });
});

describe("licence: SPDX expressions over OSI-approved ids (Z6-M2)", () => {
  const open = ["MIT", "(MIT OR Apache-2.0)", "((MIT))", "MIT AND (Apache-2.0 OR BSD-3-Clause)", "Apache-2.0 WITH LLVM-exception", "GPL-2.0-or-later WITH Classpath-exception-2.0", "GPL-2.0-only WITH Linux-syscall-note OR MIT", " MIT "];
  it.each(open)("open: %s", (l: string) => expect(isOpenSourceLicense(l)).toBe(true));
  const closed = [
    "Proprietary-exception",
    "EULA-exception",
    "MIT AND Anything-exception",
    "MIT OR Proprietary-exception",
    "Classpath-exception-2.0",
    "LicenseRef-Commercial WITH Classpath-exception-2.0",
    "Proprietary WITH Classpath-exception-2.0",
    "GPL-2.0-only WITH Made-up-exception",
    "(MIT OR GPL-2.0-only) WITH Classpath-exception-2.0",
    "MIT WITH Classpath-exception-2.0 WITH LLVM-exception",
    "MIT WITH",
    "WITH Classpath-exception-2.0",
    "MIT AND",
    "OR MIT",
    "MIT OR OR Apache-2.0",
    "MIT Apache-2.0",
    "(MIT",
    "MIT)",
    "()",
    "mit",
    "MIT or Apache-2.0",
    "GPL-2.0+",
    "",
    "   ",
  ];
  it.each(closed)("closed: %j", (l: string) => expect(isOpenSourceLicense(l)).toBe(false));
  it("a licence that is not a string is not open source", () => {
    for (const l of [undefined, null, 1, ["MIT"], { type: "MIT" }]) expect(isOpenSourceLicense(l)).toBe(false);
  });

  const card = (license: unknown) =>
    reviewPluginVersion({
      manifest: JSON.stringify({ schema: 1, id: "org.example.lic", name: "L", version: "1.0.0", description: "d", author: "a", ...(license === undefined ? {} : { license }), main: "main.js", capabilities: [{ id: "commands", reason: "r" }], repository: "https://github.com/example/plugin" }),
      main: `await lumen.commands.register({ id: "x", label: "x" }, async () => 1);`,
    });
  it.each([
    ["missing", undefined],
    ["an object", { type: "MIT" }],
    ["an array", ["MIT"]],
    ["a number", 1],
    ["empty", ""],
    ["a made-up exception", "EULA-exception"],
  ] as Array<[string, unknown]>)("a version whose licence is %s fails as closed source", async (_n: string, license: unknown) => {
    const c = await card(license);
    expect(c.passed).toBe(false);
    expect(c.findings.filter((f) => f.severity === "error").map((f) => f.rule)).toContain("closed-source");
  });
  it("an MIT version passes", async () => {
    expect((await card("MIT")).passed).toBe(true);
  });
});

describe("minified bundles: the check runs with a source shipped (Z6-L1)", () => {
  const minified = Array.from({ length: 400 }, (_, i) => `const v${i}=${i};`).join("");
  const readable = Array.from({ length: 120 }, (_, i) => `export function step${i}(value: number): number {\n  return value + ${i};\n}\n`).join("\n");
  it("a one-character source does not excuse it", () => expect(minifiedOnly(minified, "x")).toBe(true));
  it("a source that is minified itself does not excuse it", () => expect(minifiedOnly(minified, minified)).toBe(true));
  it("a readable source that is a stub next to the bundle does not excuse it", () => {
    const huge = minified.repeat(40);
    expect(minifiedOnly(huge, readable.slice(0, 600))).toBe(true);
  });
  it("a readable source of plausible size does", () => expect(minifiedOnly(minified, readable)).toBe(false));
  it("a readable bundle needs no source", () => expect(minifiedOnly(readable, undefined)).toBe(false));
  it("the review reports it with a stub source", async () => {
    const c = await reviewPluginVersion({
      manifest: JSON.stringify({ schema: 1, id: "org.example.min", name: "M", version: "1.0.0", description: "d", author: "a", license: "MIT", main: "main.js", capabilities: [{ id: "commands", reason: "r" }], repository: "https://github.com/example/plugin" }),
      main: minified,
      source: "// see the bundle",
    });
    expect(c.findings.map((f) => f.rule)).toContain("minified-only");
    expect(c.passed).toBe(false);
  });
});
