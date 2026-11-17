/**
 * `className="btn"` and `"btn btn-primary"` are used on dozens of buttons; with no rule for them a
 * classed button opted out of the dialog default (index.css, F13) and read as plain text under the
 * preflight. Each class used in the app has a rule, and it out-ranks the unlayered preflight's
 * `button` selector (one class, not a zero-specificity :where), so its background and font apply.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "index.css"), "utf8");
function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : tsx(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("the app's button classes are styled", () => {
  const used = new Set<string>();
  for (const f of tsx(SRC)) for (const m of readFileSync(f, "utf8").matchAll(/className="(btn(?: btn-[a-z]+)*)"/g)) for (const c of m[1].split(" ")) used.add(c);

  it("the app uses them (so this check is not empty)", () => {
    expect([...used].sort()).toEqual(["btn", "btn-primary"]);
  });

  it("each has a rule with a real class selector, giving background, border and font size", () => {
    const rule = (sel: string) => new RegExp(`(^|\\n)${sel.replace(/\./g, "\\.")} \\{([^}]*)\\}`).exec(css)?.[2] ?? "";
    expect(rule(".btn")).toMatch(/background:/);
    expect(rule(".btn")).toMatch(/border:/);
    expect(rule(".btn")).toMatch(/font-size:/);
    expect(rule(".btn.btn-primary")).toMatch(/background: hsl\(var\(--accent\)\)/);
    expect(rule(".btn:focus-visible")).toMatch(/outline:/);
  });
});
