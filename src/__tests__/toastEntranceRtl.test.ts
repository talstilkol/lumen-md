/**
 * Plan 9.9 (W10.E22): a toast sits at the inline end (AiToast's
 * insetInlineEnd), so its entrance comes from beyond that edge: from the
 * right in LTR, from the left in RTL. Before, `toast-slide-in` moved +20px in
 * both, so in Hebrew the toast came in from the middle of the screen.
 *
 * Runs src/index.css's own rules (the toast block) in a real browser
 * (Chromium runner) and reads the paused animation's first frame.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");

/** The custom properties and keyframes of the toast entrance, as index.css has them. */
function toastRules(): string {
  const start = css.indexOf("--toast-enter-x: 20px;");
  const kf = css.indexOf("@keyframes toast-slide-in");
  if (start < 0 || kf < 0) return css.slice(Math.max(0, kf), css.indexOf("}", css.indexOf("to {", kf)) + 4);
  const from = css.lastIndexOf(":root", start);
  const end = css.indexOf("}", css.indexOf("to {", kf));
  return css.slice(from, end + 1) + "\n}";
}

function firstFrameX(dir: "ltr" | "rtl"): number {
  document.documentElement.setAttribute("dir", dir);
  const style = document.createElement("style");
  style.textContent = toastRules();
  document.head.appendChild(style);
  const el = document.createElement("div");
  el.style.animation = "toast-slide-in 10s linear";
  document.body.appendChild(el);
  const a = el.getAnimations()[0];
  a.pause();
  a.currentTime = 0;
  const x = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
  el.remove();
  style.remove();
  return x;
}

// skip-reason: the entrance is read from Web Animations in a real browser; jsdom and happy-dom do not run them | task: W10.E22 | until: 2027-05-16
describe.runIf(typeof document !== "undefined" && typeof Element.prototype.getAnimations === "function" && typeof DOMMatrixReadOnly === "function" && !/happy-?dom/i.test(navigator.userAgent))("toast entrance follows the writing direction", () => {
  it("LTR: from +20px (the right edge)", () => {
    expect(firstFrameX("ltr")).toBe(20);
  });
  it("RTL: from −20px (the left edge, where the toast sits)", () => {
    expect(firstFrameX("rtl")).toBe(-20);
  });
});
