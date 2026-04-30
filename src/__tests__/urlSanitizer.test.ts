import { describe, expect, it } from "vitest";
import { sanitizeUrl } from "../lib/urlSanitizer";

describe("url sanitizer", () => {
  it("allows https links", () => {
    expect(sanitizeUrl("https://example.com/image.png")).toBe(true);
  });

  it("allows relative urls", () => {
    expect(sanitizeUrl("./assets/model.glb")).toBe(true);
    expect(sanitizeUrl("../images/scene.glb")).toBe(true);
    expect(sanitizeUrl("/assets/scene.glb")).toBe(true);
  });

  it("allows mailto urls", () => {
    expect(sanitizeUrl("mailto:user@example.com")).toBe(true);
  });

  it("blocks javascript urls", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe(false);
    expect(sanitizeUrl("JaVaScRiPt:alert(1)")).toBe(false);
  });

  it("blocks vbscript urls", () => {
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("blocks bare text identifiers", () => {
    expect(sanitizeUrl("example.com/file.gltf")).toBe(false);
  });

  it("blocks protocol-relative urls", () => {
    expect(sanitizeUrl("//evil.com/resource")).toBe(false);
  });

  it("blocks data urls in unsafe contexts", () => {
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("allows svg image data urls", () => {
    expect(sanitizeUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBe(true);
  });

  it("blocks broken urls", () => {
    expect(sanitizeUrl("<script>alert(1)</script>")).toBe(false);
    expect(sanitizeUrl("/assets/<bad>file")).toBe(false);
  });
});
