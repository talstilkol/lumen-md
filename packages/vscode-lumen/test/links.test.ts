import { describe, it, expect } from "vitest";
import { classifyLink } from "../src/links";

describe("classifyLink", () => {
  it("keeps in-page anchors in the webview", () => {
    expect(classifyLink("#install")).toEqual({ kind: "fragment" });
  });
  it("opens http(s)/mailto externally", () => {
    expect(classifyLink("https://lumen.md")).toEqual({ kind: "external", url: "https://lumen.md" });
    expect(classifyLink("mailto:a@b.c")).toEqual({ kind: "external", url: "mailto:a@b.c" });
  });
  it("resolves document-relative links, dropping query and keeping the fragment", () => {
    expect(classifyLink("next.md")).toEqual({ kind: "relative", path: "next.md", fragment: "" });
    expect(classifyLink("../docs/My%20Page.md?x=1#setup")).toEqual({
      kind: "relative",
      path: "../docs/My Page.md",
      fragment: "setup",
    });
    expect(classifyLink("/README.md")).toEqual({ kind: "relative", path: "/README.md", fragment: "" });
  });
  it("ignores other schemes and protocol-relative URLs", () => {
    for (const h of ["javascript:alert(1)", "command:workbench.action.quit", "file:///etc/passwd", "data:text/html,x", "//evil.test/x", ""]) {
      expect(classifyLink(h).kind, h).toBe("ignore");
    }
  });
});
