/**
 * Tests for the new "live web language" detectors. The actual rendering
 * (iframes, WebGL contexts) needs a real browser — exercised in E2E /
 * manual QA. Here we pin the smartDetect pipeline + the SVG sanitiser.
 */

import { describe, it, expect } from "vitest";
import { smartDetect, renderAs } from "../data/smartDetect";

describe("smartDetect — live web blocks", () => {
  it("recognises a pure-SVG paste as live-svg", () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>';
    expect(smartDetect(svg).kind).toBe("live-svg");
  });

  it("recognises a GLSL fragment shader as live-glsl", () => {
    const src =
      "void main() { vec2 uv = gl_FragCoord.xy / iResolution.xy; gl_FragColor = vec4(uv, 0.5, 1.0); }";
    expect(smartDetect(src).kind).toBe("live-glsl");
  });

  it("requires GLSL builtins (not just any void main)", () => {
    // C-like main without WebGL builtins shouldn't be flagged GLSL.
    const c = "int main() { return 0; }";
    expect(smartDetect(c).kind).not.toBe("live-glsl");
  });

  it("recognises a pure-CSS rule block as live-css", () => {
    const css = `.btn {\n  padding: 8px 16px;\n  border-radius: 6px;\n  background: hotpink;\n}`;
    expect(smartDetect(css).kind).toBe("live-css");
  });

  it("does NOT classify CSS-with-HTML as live-css (falls through to html-preview)", () => {
    const html = "<style>.a { color: red; }</style><div class=\"a\">hi</div>";
    expect(smartDetect(html).kind).toBe("html-preview");
  });

  it("does NOT classify huge stylesheets as live-css (falls through to code)", () => {
    // 20 rules → too many to be a demo snippet; live-css caps at 12.
    const big = Array.from({ length: 20 }, (_, i) => `.r${i} { color: #${i}; }`).join("\n");
    expect(smartDetect(big).kind).not.toBe("live-css");
  });

  it("interactive HTML still routes to htmlpreview (not live-svg)", () => {
    const html = "<canvas id=\"c\"></canvas><script>const c = document.getElementById('c');</script>";
    expect(smartDetect(html).kind).toBe("html-preview");
  });
});

describe("renderAs — live web blocks", () => {
  it("forces live-css wrap on user override", () => {
    expect(renderAs("body { color: red }", "live-css")).toBe(
      "```live-css\nbody { color: red }\n```",
    );
  });
  it("forces live-svg wrap on user override", () => {
    expect(renderAs("<svg/>", "live-svg")).toBe("```live-svg\n<svg/>\n```");
  });
  it("forces live-glsl wrap on user override", () => {
    expect(renderAs("void main(){}", "live-glsl")).toBe(
      "```live-glsl\nvoid main(){}\n```",
    );
  });
});
