// @vitest-environment node
// Review Z7-M1: a string set in a custom property reaches image-set()/src()/image() through var(), so no string sits
// inside the URL function. The reviewer's repro ($S/z7-tests/css.test.ts) expected [] there; it must now be refused.
import { describe, expect, it } from "vitest";
import { cssFindings } from "../../plugins/runtime/review";
import { cssLoads } from "../../plugins/runtime/cssUrls";

const remote = (css: string) => cssFindings(css).filter((f) => f.rule === "css-remote-url");

describe("Z7-M1: substitution into a URL function", () => {
  it("var() string into image-set() is refused", () => {
    const css = `:root{--x:"https://evil.example/a.png"} body{background-image:image-set(var(--x) 1x)}`;
    expect(remote(css)).toHaveLength(1);
    expect(remote(css)[0].severity).toBe("error");
  });
  it("var() string into src() is refused", () => {
    const css = `:root{--y:"https://evil.example/f.woff2"} @font-face{font-family:x;src:src(var(--y))}`;
    expect(remote(css)).toHaveLength(1);
  });
  it("var() in image(), -webkit-image-set(), env() and attr() are refused", () => {
    for (const css of [
      `a{background:image(var(--x))}`,
      `a{background:-webkit-image-set(var(--x) 1x)}`,
      `a{background:image-set(env(--x) 1x)}`,
      `a{background:image-set(attr(data-x type(<url>)) 1x)}`,
      `a{background:image-set(V\\61r(--x) 1x)}`,
      `a{background:image-set(image(var(--x)) 1x)}`,
    ])
      expect(remote(css).length, css).toBeGreaterThan(0);
  });
  it("a remote string in a var() fallback inside a URL function is reported as that origin", () => {
    const f = remote(`a{background:image-set(var(--none, "https://evil.example/b.png") 1x)}`);
    expect(f.some((x) => x.detail.startsWith("https://evil.example"))).toBe(true);
  });
  it("the direct form is still caught, and var() outside a URL function is fine", () => {
    expect(remote(`a{background:image-set("https://evil.example/a.png" 1x)}`)).toHaveLength(1);
    expect(cssFindings(`:root{--c:#fff} a{color:var(--c);background:image-set("a.png" 1x, "b.png" type("image/png") 2x)}`)).toEqual([]);
    expect(cssLoads(`a{color:var(--c)}`)).toEqual([]);
  });
  it("url(var(--x)) is a bad url the browser never loads, and is still not a remote load", () => {
    expect(remote(`:root{--x:"https://evil.example/a.png"} a{background:url(var(--x))}`)).toEqual([]);
  });
});
