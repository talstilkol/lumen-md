import { describe, it, expect } from "vitest";
import { parseLaunch } from "../pwa/launch";

describe("parseLaunch (D3)", () => {
  it("nothing → none", () => {
    expect(parseLaunch("")).toEqual({ kind: "none" });
    expect(parseLaunch("?foo=1")).toEqual({ kind: "none" });
  });
  it("shortcuts", () => {
    expect(parseLaunch("?action=new")).toEqual({ kind: "action", action: "new" });
    expect(parseLaunch("?action=palette")).toEqual({ kind: "action", action: "palette" });
    expect(parseLaunch("?action=rm")).toEqual({ kind: "none" });
  });
  it("share with title, text and url", () => {
    const r = parseLaunch("?title=Hello&text=Some%20text&url=https%3A%2F%2Fex.com%2Fa");
    expect(r).toEqual({ kind: "share", title: "Hello", body: "# Hello\n\nSome text\n\n<https://ex.com/a>\n" });
  });
  it("Android: link inside text", () => {
    const r = parseLaunch("?text=https%3A%2F%2Fexample.org%2Fx");
    expect(r.kind).toBe("share");
    if (r.kind === "share") {
      expect(r.title).toBe("example.org");
      expect(r.body).toContain("<https://example.org/x>");
      expect(r.body).not.toContain("\nhttps://");
    }
  });
  it("text only → first line as heading", () => {
    const r = parseLaunch("?text=" + encodeURIComponent("שלום עולם\nשורה שנייה"));
    expect(r.kind === "share" && r.title).toBe("שלום עולם");
  });
});
