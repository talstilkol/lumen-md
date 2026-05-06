import { describe, expect, it } from "vitest";
import { sanitizeHtmlMarkup, sanitizeSvgMarkup } from "../lib/markupSanitizer";

describe("markup sanitizer", () => {
  it("removes HTML script tags", () => {
    const input = "<p>ok</p><script>alert(1)</script>";
    expect(sanitizeHtmlMarkup(input)).toBe("<p>ok</p>");
  });

  it("removes inline event handlers (verifies the attribute hook fires)", () => {
    // Use <p> rather than <button>: the latter is in HTML_FORBID_TAGS
    // and gets removed entirely (a stricter policy that's also safe
    // but obscures whether the event-handler hook fired).
    const input = "<p onclick=\"alert(1)\">a</p>";
    expect(sanitizeHtmlMarkup(input)).toContain("<p>");
    expect(sanitizeHtmlMarkup(input)).not.toContain("onclick");
  });

  it("strips on* handlers across multiple sequential calls (regression: hook installed only on first instance)", () => {
    // Before the markupSanitizer fix, the attribute-stripping hook was
    // only installed on the FIRST DOMPurify instance (module-scoped
    // `hooksInstalled` boolean + per-call `DOMPurify(window)` factory).
    // Every subsequent sanitize() call ran without the hook —
    // event-handler / javascript:-style / data:text/html filtering
    // silently failed. This test runs three back-to-back to pin the
    // cached-instance behavior.
    const inputs = [
      "<p onerror=\"x()\">a</p>",
      "<a href=\"https://ok\" onmouseover=\"y()\">b</a>",
      "<div onload=\"z()\">c</div>",
    ];
    for (const input of inputs) {
      const out = sanitizeHtmlMarkup(input);
      expect(out).not.toMatch(/on(?:error|mouseover|load|click|keydown)\s*=/i);
    }
  });

  it("strips event handlers across HTML and SVG modes consistently", () => {
    expect(sanitizeHtmlMarkup('<p onmouseover="x">a</p>')).not.toContain("onmouseover");
    expect(sanitizeSvgMarkup('<svg><circle onclick="x" /></svg>')).not.toContain("onclick");
    expect(sanitizeHtmlMarkup('<p onkeydown="x">b</p>')).not.toContain("onkeydown");
  });

  it("removes dangerous javascript href in html", () => {
    const input = "<a href=\"javascript:alert(1)\">bad</a>";
    expect(sanitizeHtmlMarkup(input)).toContain("<a>");
    expect(sanitizeHtmlMarkup(input)).not.toContain("javascript:");
  });

  it("sanitizes svg script payloads", () => {
    const input = "<svg><script>alert(1)</script><circle cx=10 cy=10 r=5 /></svg>";
    const output = sanitizeSvgMarkup(input);
    expect(output).toContain("<svg");
    expect(output).not.toContain("<script");
    expect(output).toContain("<circle");
  });

  it("keeps SVG basic shape tags", () => {
    const input = "<svg><rect width=\"10\" height=\"10\" /></svg>";
    expect(sanitizeSvgMarkup(input)).toContain("<rect");
  });

  it("removes object and embed tags", () => {
    const input = "<div><object data=\"http://bad.test\"></object><embed src=\"http://bad.test\" /></div>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).not.toContain("object");
    expect(out).not.toContain("embed");
  });

  it("removes form and input controls", () => {
    const input = "<form action=\"javascript:alert(1)\"><input name=\"x\"/></form>";
    expect(sanitizeHtmlMarkup(input)).not.toContain("form");
    expect(sanitizeHtmlMarkup(input)).not.toContain("input");
  });

  it("keeps safe HTTPS links", () => {
    const input = "<a href=\"https://example.com\">safe</a>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("example.com");
    expect(out).toContain("safe");
  });

  it("keeps mailto links", () => {
    const input = "<a href=\"mailto:user@example.com\">email</a>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("user@example.com");
    expect(out).not.toContain("javascript:");
  });

  it("strips javascript in style attributes", () => {
    const input = "<div style=\"background:url(javascript:alert(1))\">x</div>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("<div");
  });

  it("strips vbscript from href", () => {
    const input = "<a href=\"vbscript:alert(1)\">x</a>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("<a>");
    expect(out).not.toContain("vbscript:");
  });

  it("strips data:text/html href values", () => {
    const input = "<a href=\"data:text/html,<script>alert(1)</script>\">x</a>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("<a>");
    expect(out).not.toContain("data:text/html");
  });

  it("keeps allowed base64 image data URLs", () => {
    const input = "<img src=\"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=\" alt=\"ok\" />";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("data:image/svg+xml;base64");
    expect(out).toContain("alt=\"ok\"");
  });

  it("removes disallowed SVG foreignObject", () => {
    const input = "<svg><foreignObject>bad</foreignObject></svg>";
    const out = sanitizeSvgMarkup(input);
    expect(out).not.toContain("foreignObject");
  });

  it("removes svg onerror handlers", () => {
    const input = "<svg><image onerror=\"alert(1)\" href=\"data:image/png;base64,AAA\"/></svg>";
    const out = sanitizeSvgMarkup(input);
    expect(out).not.toContain("onerror");
  });

  it("removes xlink:href javascript payload in svg", () => {
    const input = "<svg><a xlink:href=\"javascript:alert(1)\">x</a></svg>";
    const out = sanitizeSvgMarkup(input);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a");
  });

  it("keeps benign UTF-8 text", () => {
    const input = "<p>שלום — secure ✅</p>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("שלום");
    expect(out).toContain("✅");
  });

  it("does not break on malformed html", () => {
    const input = "<div><script>alert(1)";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("<div>");
    expect(out).not.toContain("<script>");
  });

  it("strips iframe tags and keeps safe content", () => {
    const input = "<div>before</div><iframe src=\"https://example.com\"></iframe><div>after</div>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).not.toContain("iframe");
  });

  it("strips meta tags", () => {
    const input = "<meta http-equiv=\"refresh\" content=\"0;url=https://evil.com\"><p>ok</p>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).not.toContain("<meta");
    expect(out).toContain("<p");
  });

  it("handles empty input as empty output", () => {
    expect(sanitizeHtmlMarkup("")).toBe("");
    expect(sanitizeSvgMarkup("")).toBe("");
  });

  it("keeps plain text with angle-bracket escapes", () => {
    const input = "a < b && b > c";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("a &lt; b");
    expect(out).toContain("b &gt; c");
  });

  it("strips onpaste attribute and keeps allowed href", () => {
    const input = "<p onpaste=\"alert(1)\"><a href=\"https://openai.com\">link</a></p>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).not.toContain("onpaste");
    expect(out).toContain("https://openai.com");
  });

  it("keeps basic svg circle without script", () => {
    const input = "<svg><circle cx=\"50\" cy=\"50\" r=\"20\" fill=\"blue\"/></svg>";
    const out = sanitizeSvgMarkup(input);
    expect(out).toContain("<circle");
    expect(out).not.toContain("fill=\"blue\"");
  });

  it("strips script from SVG text payloads", () => {
    const input = "<svg><desc><![CDATA[<script>alert(1)</script>]]></desc></svg>";
    const out = sanitizeSvgMarkup(input);
    expect(out).toContain("<svg");
    expect(out).not.toContain("<script");
  });

  it("preserves safe inline styles in container elements", () => {
    const input = "<p style=\"color: red\">safe</p>";
    const out = sanitizeHtmlMarkup(input);
    expect(out).toContain("safe");
    expect(out).toContain("<p");
  });
});
