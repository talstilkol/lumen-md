import { describe, it, expect } from "vitest";
import { plotPages, toLines, webrBaseUrl } from "../plugins/r/rRuntime";

describe("live-r runtime helpers", () => {
  it("serves webR under the app base path", () => {
    expect(webrBaseUrl("/")).toBe("/webr/");
    expect(webrBaseUrl("/app")).toBe("/app/webr/");
    expect(webrBaseUrl("/app/")).toBe("/app/webr/");
  });

  it("maps captured R output to display lines", () => {
    expect(
      toLines([
        { type: "stdout", data: "[1] 42" },
        { type: "message", data: { message: "note" } },
        { type: "warning", data: { message: "careful" } },
        { type: "error", data: { message: "object 'y' not found" } },
        { type: "stderr", data: "raw stderr" },
      ]),
    ).toEqual([
      { kind: "out", text: "[1] 42" },
      { kind: "msg", text: "note" },
      { kind: "warn", text: "careful" },
      { kind: "err", text: "object 'y' not found" },
      { kind: "err", text: "raw stderr" },
    ]);
  });
});

describe("plot pages", () => {
  it("keeps the last frame of each page", () => {
    const a1 = { width: 1 } as ImageBitmap;
    const a2 = { width: 2 } as ImageBitmap;
    const b1 = { width: 3 } as ImageBitmap;
    const msgs = [
      { type: "stdout", data: "x" },
      { type: "canvas", data: { event: "canvasNewPage" } },
      { type: "canvas", data: { event: "canvasImage", image: a1 } },
      { type: "canvas", data: { event: "canvasImage", image: a2 } },
      { type: "canvas", data: { event: "canvasNewPage" } },
      { type: "canvas", data: { event: "canvasImage", image: b1 } },
      { type: "canvas", data: { event: "canvasNewPage" } }, // empty page: dropped
    ];
    expect(plotPages(msgs)).toEqual([a2, b1]);
  });
});
