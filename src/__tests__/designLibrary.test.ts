// @vitest-environment node
/**
 * Plan W3.1 — the component library is documented, and the documentation
 * cannot go stale (docs/src/content/docs/contributing/design-system.md,
 * "Component library"):
 *   - every export a row names is exported by the file the row names (a CSS
 *     class is defined in that stylesheet);
 *   - every module of src/ui that many app files import (a shared component in
 *     fact) has a row, so a new shared part cannot stay undocumented;
 *   - the Hebrew page has the same rows (the same names, the same files).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const DOC = "docs/src/content/docs/contributing/design-system.md";
const DOC_HE = "docs/src/content/docs/he/contributing/design-system.md";
/** A src/ui module imported by at least this many app files (tests excluded) is shared, and must be in the table. */
const SHARED_AT = 8;

type Row = { names: string[]; file: string };

/** The rows of the first table under the "Component library" heading (or its Hebrew one). */
function libraryRows(md: string, heading: RegExp): Row[] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return [];
  const rows: Row[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break;
    if (!l.startsWith("|") || /^\|[-\s|]+\|$/.test(l)) continue;
    const cells = l.split("|").slice(1, -1);
    if (cells.length < 4) continue;
    const ticks = (c: string) => [...c.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const file = ticks(cells[1])[0];
    if (!file || !/^src\//.test(file)) continue; // the header row
    rows.push({ names: ticks(cells[0]), file });
  }
  return rows;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" || f === "node_modules" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const rows = libraryRows(read(DOC), /^##\s+Component library\b/);

describe("the component library page (W3.1)", () => {
  it("the table parser reads names and files, and skips the header", () => {
    const md = "## Component library\n\n| Component | Import | For | You get |\n|---|---|---|---|\n| `A`, `b` | `src/ui/A.tsx` | x | y |\n\n## Next\n| `C` | `src/ui/C.tsx` | x | y |\n";
    expect(libraryRows(md, /^##\s+Component library\b/)).toEqual([{ names: ["A", "b"], file: "src/ui/A.tsx" }]);
  });

  it("every row's export exists in its file (a class in its stylesheet)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const { names, file } of rows) {
      const src = read(file);
      for (const n of names) {
        if (n.startsWith(".")) {
          expect(src, `${n} in ${file}`).toMatch(new RegExp(`\\${n}\\b[^{]*\\{`));
          continue;
        }
        const exported = new RegExp(`export\\s+(?:const|function|class|interface|type|let)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`);
        expect(exported.test(src), `${n} is exported by ${file}`).toBe(true);
      }
    }
  });

  it(`every src/ui module that ${SHARED_AT}+ app files import has a row`, () => {
    const files = sourceFiles(join(ROOT, "src"));
    const texts = files.map((f) => [relative(ROOT, f), readFileSync(f, "utf8")] as const);
    const documented = new Set(rows.map((r) => r.file.replace(/\.(tsx?|css)$/, "")));
    const missing: string[] = [];
    for (const f of readdirSync(join(ROOT, "src/ui")).filter((x) => /\.(ts|tsx)$/.test(x) && !/Strings\.ts$/.test(x))) {
      const mod = f.replace(/\.(tsx?)$/, "");
      const spec = new RegExp(`from\\s+["'](?:\\.{1,2}/)+(?:ui/)?${mod}["']`);
      const users = texts.filter(([p, t]) => p !== `src/ui/${f}` && spec.test(t)).length;
      if (users >= SHARED_AT && !documented.has(`src/ui/${mod}`)) missing.push(`src/ui/${f} (${users} importers)`);
    }
    expect(missing).toEqual([]);
  });

  it("the Hebrew page lists the same components in the same files", () => {
    const he = libraryRows(read(DOC_HE), /^##\s+ספריית הרכיבים/);
    expect(he).toEqual(rows);
  });
});
