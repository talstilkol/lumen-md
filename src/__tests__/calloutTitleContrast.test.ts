/**
 * F16: a callout's title is text, so it needs ≥ 4.5:1 (WCAG AA) on the
 * callout's own tint over the page, in light mode with no theme (the default
 * :root tokens) and in dark mode (.dark). axe found every type's title below
 * it in light mode (the accent --co was used as the text colour: 2.0–3.6:1).
 *
 * The colours are read from src/index.css itself: the title rule's colour
 * variable, resolved per callout type, and --bg / --callout-ink-l from the
 * :root and .dark token blocks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio, hslToRgb, type Rgb } from "../lib/contrast";

const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!m) throw new Error(`no rule ${selector}`);
  const out: Record<string, string> = {};
  for (const d of m[1].replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const i = d.indexOf(":");
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
}

const ROOT = rule(":root");
const DARK = rule(".dark");
const BASE = rule(".callout");
const TYPES: Record<string, string> = {
  note: ".callout",
  info: ".callout-abstract, .callout-info, .callout-todo",
  tip: ".callout-tip, .callout-success",
  warning: ".callout-question, .callout-warning",
  danger: ".callout-failure, .callout-danger, .callout-bug",
  example: ".callout-example",
  quote: ".callout-quote",
};

/** `var(--x, fallback)` with the given variables, recursively. */
function resolveVars(value: string, vars: Record<string, string>): string {
  let v = value;
  for (let i = 0; i < 10 && v.includes("var("); i++) v = v.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (_m, name: string, fb?: string) => vars[name] ?? fb ?? "");
  return v.trim();
}

function triplet(value: string): Rgb {
  const m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (!m) throw new Error(`not an HSL triplet: "${value}"`);
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

const over = (fg: Rgb, bg: Rgb, a: number): Rgb => ({ r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) });

/** The title colour variable: `.callout-title { color: hsl(var(--x)) }`. */
function titleVar(): string {
  const m = /hsl\(var\((--[\w-]+)\)\)/.exec(rule(".callout-title").color ?? "");
  if (!m) throw new Error("the callout title colour is not hsl(var(--token))");
  return m[1];
}

describe("callout titles: ≥ 4.5:1 on their tint (F16)", () => {
  it("the quote-style title (blockquote.callout > p:first-child) uses the same colour as .callout-title", () => {
    const m = /hsl\(var\((--[\w-]+)\)\)/.exec(rule("blockquote.callout > p:first-child").color ?? "");
    expect(m?.[1]).toBe(titleVar());
  });

  for (const [mode, tokens] of [
    ["light, no theme", ROOT],
    ["dark", { ...ROOT, ...DARK }],
  ] as const) {
    for (const [kind, selector] of Object.entries(TYPES)) {
      it(`${kind} — ${mode}`, () => {
        const decls = { ...tokens, ...BASE, ...rule(selector) };
        const page = triplet(resolveVars(tokens["--bg"], tokens));
        const tint = over(triplet(resolveVars(decls["--co"], decls)), page, 0.08);
        const text = triplet(resolveVars(decls[titleVar()] ?? "", decls));
        const ratio = contrastRatio(text, tint);
        expect(ratio, `${kind} title ${resolveVars(decls[titleVar()] ?? "", decls)} on its tint`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(text, page)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
