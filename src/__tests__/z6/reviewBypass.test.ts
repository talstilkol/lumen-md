import { describe, expect, it } from "vitest";
import { cssFindings, isOpenSourceLicense, minifiedOnly } from "../../plugins/runtime/review";

describe("Z6 plugin review bypasses", () => {
  it("quoted url() containing ')' is still a remote load", () => {
    expect(cssFindings(`a{background:url("https://evil.example/a)b.png")}`).length).toBeGreaterThan(0);
  });
  it("quoted url() containing the other quote is still a remote load", () => {
    expect(cssFindings(`a{background:url("https://evil.example/it's.png")}`).length).toBeGreaterThan(0);
  });
  it("a tab inside the scheme (URL parser strips it) is still a remote load", () => {
    expect(cssFindings(`a{background:url("ht\\9 tps://evil.example/x.png")}`).length).toBeGreaterThan(0);
  });
  it("'/<tab>/host' is protocol-relative after URL parsing", () => {
    expect(cssFindings(`a{background:url("/\\9/evil.example/x.png")}`).length).toBeGreaterThan(0);
  });
  it("a made-up '-exception' id is not an open-source licence", () => {
    expect(isOpenSourceLicense("Proprietary-exception")).toBe(false);
  });
  it("sanity: plain remote url is caught", () => {
    expect(cssFindings(`a{background:url(https://evil.example/x.png)}`).length).toBe(1);
  });
  it("minifiedOnly: one-char 'source' does not excuse a minified bundle", () => {
    expect(minifiedOnly("x".repeat(5000), "x")).toBe(true);
  });
});
