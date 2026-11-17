import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { SURFACES as WCAG22_SURFACES, openSurface } from "./_surfaces";

/**
 * Accessibility (plan 10.1.5, 10.1.6). axe-core (WCAG 2.0/2.1 A + AA,
 * colour contrast included) on the main screen and on each modal surface,
 * in English (LTR) and Hebrew (RTL), light and dark: no serious or critical
 * violation. Then a keyboard-only journey.
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type Violation = { id: string; impact: string | null; help: string; nodes: Array<{ target: string[]; detail?: string }> };

async function axe(page: Page, include?: string): Promise<Violation[]> {
  // Evaluated over the DevTools protocol: the page's CSP doesn't apply.
  await page.evaluate(AXE);
  return page.evaluate(async (sel) => {
    const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Violation[] }> } };
    const r = await w.axe.run(sel ? { include: [sel] } : document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    });
    type Node = { target: string[]; any?: Array<{ data?: { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string } }> };
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: (v.nodes as unknown as Node[]).slice(0, 8).map((n) => {
        const d = n.any?.[0]?.data;
        return { target: n.target, detail: d?.fgColor ? `${d.fgColor} on ${d.bgColor} = ${d.contrastRatio} (needs ${d.expectedContrastRatio})` : undefined };
      }),
    }));
  }, include ?? null);
}

const blocking = (vs: Violation[]) => vs.filter((v) => v.impact === "serious" || v.impact === "critical");
const report = (vs: Violation[]) => vs.map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")}${n.detail ? ` — ${n.detail}` : ""}`).join("\n")}`).join("\n");

const run = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

async function boot(page: Page, lang: "en" | "he", theme: "light" | "dark") {
  await page.addInitScript(
    ([l, th]) => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l, theme: th }, version: 0 }));
    },
    [lang, theme] as const,
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "he" ? "rtl" : "ltr");
}

/** The surfaces: the main screen, then each modal opened from the palette. */
const SURFACES: Array<{ name: string; open?: (page: Page) => Promise<void>; scope?: string }> = [
  { name: "main screen" },
  { name: "command palette", open: (p) => p.keyboard.press("ControlOrMeta+k"), scope: '[role="dialog"]' },
  { name: "search", open: (p) => run(p, "view.search"), scope: '[role="dialog"]' },
  { name: "keyboard shortcuts", open: (p) => p.keyboard.press("ControlOrMeta+/"), scope: '[role="dialog"]' },
  { name: "theme settings", open: (p) => run(p, "settings.theme"), scope: '[role="dialog"]' },
  { name: "setup", open: (p) => run(p, "help.setup"), scope: '[role="dialog"]' },
];

for (const lang of ["en", "he"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: no serious or critical violations — ${lang === "he" ? "Hebrew RTL" : "English LTR"}, ${theme}`, async ({ page }) => {
      await boot(page, lang, theme);
      const found: string[] = [];
      for (const s of SURFACES) {
        if (s.open) {
          await s.open(page);
          await expect(page.locator('[role="dialog"][aria-modal="true"]').first()).toBeVisible({ timeout: 10_000 });
        }
        const vs = blocking(await axe(page, s.scope));
        if (vs.length) found.push(`— ${s.name}\n${report(vs)}`);
        if (s.open) {
          await page.keyboard.press("Escape");
          await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0, { timeout: 5_000 });
        }
      }
      expect(found.join("\n"), "axe serious/critical violations").toBe("");
    });
  }
}

test("keyboard only: palette, a dialog that keeps focus and gives it back, the sidebar edge", async ({ page }) => {
  await boot(page, "en", "light");
  const editor = page.locator(".cm-content").first();
  await editor.click();

  // ⌘K opens the palette with focus in its input; Escape closes it and focus is back in the editor.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator('[role="dialog"][aria-modal="true"]').first();
  await expect(palette).toBeVisible();
  await expect(palette.locator("input").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(editor).toBeFocused();

  // A dialog from the palette by keyboard: type, Enter.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Theme settings");
  await page.keyboard.press("Enter");
  const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
  await expect(dialog).toBeVisible();
  // Tab never leaves the dialog: 25 presses, focus stays inside.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press(i % 5 === 4 ? "Shift+Tab" : "Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(editor).toBeFocused();

  // The sidebar's edge is a focusable separator; arrows resize it.
  const edge = page.getByRole("separator", { name: "Resize the sidebar" });
  if (!(await edge.isVisible())) await run(page, "view.workspace");
  await expect(edge).toBeVisible();
  await edge.focus();
  const before = Number(await edge.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  await expect(edge).toHaveAttribute("aria-valuenow", String(before + 16));
  await page.keyboard.press("Home");
  await expect(edge).toHaveAttribute("aria-valuenow", "160");
  const sidebar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width").trim());
  expect(sidebar).toBe("160px");
});

/**
 * Plan W13.Y3 / W13.Y5: the WCAG 2.2 checks axe can't make (src/a11y/wcag22.ts),
 * on the ten surfaces of e2e/_surfaces.ts, in English and Hebrew:
 * 2.5.3 label in name, 2.5.8 target size, 2.4.11 focus not obscured while tabbing.
 */

for (const lang of ["en", "he"] as const) {
  test(`WCAG 2.2: label in name, target size, focus not obscured — ${lang === "he" ? "Hebrew RTL" : "English LTR"}`, async ({ page }) => {
    await boot(page, lang, "light");
    const found: string[] = [];
    for (const s of WCAG22_SURFACES) {
      const close = await openSurface(page, s);
      const scope = s.modal ? '[role="dialog"][aria-modal="true"]' : "body";
      const r = await page.evaluate(async (sel) => {
        const w = await import("/src/a11y/wcag22.ts");
        const root = document.querySelector(sel) ?? document.body;
        return {
          label: w.labelInNameViolations(root).map((v: { visible: string; name: string }) => `“${v.visible}” named “${v.name}”`),
          target: w.targetSizeViolations(root).map((e: Element) => e.outerHTML.slice(0, 90)),
        };
      }, scope);
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Tab");
        const hidden = await page.evaluate(async () => {
          const w = await import("/src/a11y/wcag22.ts");
          const el = document.activeElement;
          return el && el !== document.body && w.focusObscured(el) ? el.outerHTML.slice(0, 90) : null;
        });
        if (hidden) found.push(`— ${s.name}: focus hidden: ${hidden}`);
      }
      for (const l of r.label) found.push(`— ${s.name}: 2.5.3 ${l}`);
      for (const t of r.target) found.push(`— ${s.name}: 2.5.8 ${t}`);
      await close();
    }
    expect(found.join("\n"), "WCAG 2.2 violations").toBe("");
  });
}
