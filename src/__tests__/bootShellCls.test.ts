/**
 * W10.E20 (plan W2.21) — the boot shell's note shifts nothing: CLS = 0 from
 * the shell's first paint through typing in it, for a 100-character note and
 * a 10,000-character one. The page here is index.html's own <style> and boot
 * shell with public/boot.js, in a real layout engine: it runs where the
 * browser reports layout shifts (Chromium) and is skipped where it cannot
 * (jsdom, happy-dom). The whole start, up to the editor, is
 * e2e/cold-start.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const html = readFileSync(join(root, "index.html"), "utf8");
const script = readFileSync(join(root, "public/boot.js"), "utf8");
const style = /<style>([\s\S]*?)<\/style>/.exec(html.slice(0, html.indexOf("</head>")))![1];
const shell = /<div class="boot-shell"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(html)![0];
const canMeasure = typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes("layout-shift");
const frames = (n = 2) => new Promise<void>((r) => { const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : r()); step(n); });

/** A cold start of the shell: boot.js in <head>, then the parser adds the shell; then `typing` lines are typed. */
async function start(content: string, typing: number): Promise<{ cls: number; box: DOMRect; chars: number }> {
  localStorage.setItem("lumen-md", JSON.stringify({ state: { doc: { name: "n.md", content } }, version: 0 }));
  document.documentElement.removeAttribute("data-boot-note");
  document.body.innerHTML = "";
  const css = document.createElement("style");
  css.textContent = style;
  document.head.appendChild(css);
  let cls = 0;
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries() as Array<PerformanceEntry & { value: number }>) cls += e.value;
  });
  po.observe({ type: "layout-shift", buffered: false });
  new Function(script)();
  const host = document.createElement("div");
  host.id = "root";
  host.innerHTML = shell;
  document.body.appendChild(host);
  await frames();
  const el = document.querySelector<HTMLTextAreaElement>("textarea.boot-note")!;
  const box = el.getBoundingClientRect();
  el.focus();
  for (let i = 0; i < typing; i++) {
    el.value += `\nשורה ${i} line typed before the app loaded`;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await frames(1);
  }
  await frames();
  po.disconnect();
  const after = el.getBoundingClientRect();
  expect([after.top, after.height, after.width]).toEqual([box.top, box.height, box.width]);
  const chars = el.value.length;
  host.remove();
  css.remove();
  return { cls, box, chars };
}

// skip-reason: layout shifts are measured only where the engine reports layout-shift entries (Chromium); jsdom and happy-dom have no layout | task: W10.E20 | until: 2027-05-16
describe.runIf(canMeasure)("the boot note shifts nothing (Chromium)", () => {
  it("CLS = 0 for a 100-character note and a 10,000-character one, typing 40 lines into each; the same box", async () => {
    const small = await start("# פתק\n\n" + "x".repeat(92), 40);
    const big = await start("# פתק\n\n" + "שלום עולם ".repeat(1000), 40);
    expect(small.cls).toBe(0);
    expect(big.cls).toBe(0);
    expect([big.box.top, big.box.height, big.box.width]).toEqual([small.box.top, small.box.height, small.box.width]);
    // The long note puts no more than 4,000 characters in the page (plus what was typed).
    expect(big.chars).toBeLessThanOrEqual(4000 + 40 * 60);
  });
});

describe("the measurement itself", () => {
  it("the shell and its CSS are read from index.html", () => {
    expect(shell).toContain('class="boot-page"');
    expect(style).toContain(".boot-note{");
    // A fixed box: typing grows the textarea's scroll height, not its box.
    expect(style).toMatch(/\.boot-note\{[^}]*height:calc\(100vh - 140px\)[^}]*resize:none/);
  });
});
