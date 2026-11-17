/**
 * 9.3 — logical CSS in the preview and editor rules; Unicode page slugs in the site export.
 * W13.H2 — the logical-CSS gate over the whole of src/ (scripts/check-logical-css.mjs).
 */
import { describe, it, expect } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { findCssViolations } from "../../scripts/check-code-hygiene.mjs";
import { pageFileSlug } from "../lib/slug";
import { markdownToStaticSiteBytes } from "../storage/exportFormats";
import { unzip } from "../storage/zip";
// @ts-expect-error — plain .mjs script without type declarations
import { scanCss, scanTs, scanClassString, physicalFix } from "../../scripts/lib/logicalCss.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { run, BASELINE_PATH } from "../../scripts/check-logical-css.mjs";

type Violation = { line: number; rule: string; text: string };
const css = (src: string): Violation[] => findCssViolations("x.css", src);

describe("hygiene: physical CSS in .prose-lumen / .cm-* rules", () => {
  it("flags physical properties and values, and names the logical one", () => {
    const v = css(
      [
        ".prose-lumen blockquote { margin-left: 1rem; padding-right: 2px; border-left: 3px solid; }",
        ".cm-editor .cm-tooltip { left: 0; text-align: right; float: left; border-top-left-radius: 4px; }",
      ].join("\n"),
    );
    expect(v.map((x) => x.text.split(" → ")[1])).toEqual([
      "margin-inline-start",
      "padding-inline-end",
      "border-inline-start",
      "inset-inline-start",
      "text-align: end",
      "float: start (inline-start / inline-end)",
      "border-start-start-radius",
    ]);
    expect(v.every((x) => x.rule === "physical-css" && x.line >= 1)).toBe(true);
  });

  it("flags shorthands that set left and right differently, not symmetric ones (review: #219)", () => {
    const v = css(
      [
        ".prose-lumen blockquote { border-radius: 0 0.5rem 0.5rem 0; }",
        ".prose-lumen aside { border-radius: 4px 0; }",
        ".prose-lumen dl { border-radius: 2px 4px 6px; }",
        ".prose-lumen dd { margin: 0 1rem 0 2rem; }",
        ".cm-panel { padding: 1px calc(2px + 1px) 3px 0; }",
        ".prose-lumen figure { border-width: 1px 2px 1px 0; }",
      ].join("\n"),
    );
    expect(v).toHaveLength(6);
    expect(v[0].text).toContain("border-start-end-radius");
    expect(v[3].text).toContain("margin-inline-start");
    expect(
      css(
        [
          ".prose-lumen img { border-radius: 0.5rem; }",
          ".prose-lumen .a { border-radius: 4px 4px 0 0; }", // top corners only: symmetric
          ".prose-lumen .b { border-radius: 2px 2px 6px 6px; }",
          ".prose-lumen .c { border-radius: 4px / 2px; }",
          ".prose-lumen table { margin: 0 auto; }",
          ".cm-line { padding: 0 0.5rem; }",
          ".prose-lumen .d { margin: 1px 2px 3px 2px; }",
          ".prose-lumen .e { padding: 0 var(--gap) 0 var(--gap); }",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("leaves logical properties and rules outside the preview and editor alone", () => {
    expect(
      css(
        [
          ".prose-lumen blockquote { margin-inline-start: 1rem; border-inline-start: 3px solid; text-align: start; inset-inline-end: 0 }",
          ".sidebar { margin-left: 4px; float: right }",
          ".prose-lumen table { text-align: center; margin: 0 auto }",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("honours a justified hygiene-allow comment on the line or the line above", () => {
    expect(css(".cm-cursor {\n  /* hygiene-allow: CodeMirror's caret */\n  border-left-width: 2px;\n}")).toEqual([]);
    expect(css(".cm-cursor { border-left-width: 2px; /* hygiene-allow: caret */ }")).toEqual([]);
    expect(css(".cm-cursor {\n  /* hygiene-allow: */\n  border-left-width: 2px;\n}")).toHaveLength(1);
  });

  it("the app's own stylesheets pass", () => {
    const src = join(__dirname, "..");
    for (const f of ["index.css", "ui/CommandPalette.css", "ui/FileTree.css", "ui/PromptDialog.css"]) {
      expect(css(readFileSync(join(src, f), "utf8")), f).toEqual([]);
    }
  });
});

describe("site export page names (Unicode slugs)", () => {
  it("keeps Hebrew, Arabic and CJK titles readable, drops niqqud and punctuation", () => {
    expect(pageFileSlug("מדריך: התקנה (גרסה 2)", "page-1")).toBe("מדריך-התקנה-גרסה-2");
    expect(pageFileSlug("שָׁלוֹם עוֹלָם", "page-1")).toBe("שלום-עולם");
    expect(pageFileSlug("مرحبا بالعالم", "page-1")).toBe("مرحبا-بالعالم");
    expect(pageFileSlug("日本語のテスト", "page-1")).toBe("日本語のテスト");
    expect(pageFileSlug("Getting Started!", "page-1")).toBe("getting-started");
    expect(pageFileSlug("  ?! ", "page-4")).toBe("page-4");
    expect(Array.from(pageFileSlug("א".repeat(200), "p")).length).toBe(80);
  });

  it("a Hebrew site gets Hebrew page files, encoded links and an RTL page", async () => {
    const md = "# מדריך התקנה\n\nשלום.\n\n# שאלות נפוצות\n\n- אחת";
    const bytes = await markdownToStaticSiteBytes(md, "תיעוד");
    const files = await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const names = [...files.keys()];
    expect(names).toContain("מדריך-התקנה.html");
    expect(names).toContain("שאלות-נפוצות.html");
    expect(names.some((n) => /^page-\d/.test(n))).toBe(false); // the old ASCII-only slug turned both into page-N
    const page = new TextDecoder().decode(files.get("מדריך-התקנה.html")!);
    expect(page).toContain(`href="${encodeURIComponent("שאלות-נפוצות.html")}"`);
    expect(page).toContain('dir="rtl"');
    expect(page).toContain('aria-current="page"');
    expect(new TextDecoder().decode(files.get("style.css")!)).toContain("border-inline-end");
  });

  it("two titles with the same slug get distinct files", async () => {
    const bytes = await markdownToStaticSiteBytes("# שלום\n\nא\n\n# שָׁלוֹם\n\nב", "S");
    const names = [...(await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).keys()];
    expect(names.filter((n) => n.startsWith("שלום")).length).toBe(2);
  });
});

/* ---- W13.H2: the whole-of-src gate ---- */

const ROOT = resolve(__dirname, "..", "..");

function tree(files: Record<string, string>, baseline?: Record<string, number>) {
  const dir = mkdtempSync(join(tmpdir(), "logical-css-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  mkdirSync(join(dir, "scripts"), { recursive: true });
  if (baseline) writeFileSync(join(dir, BASELINE_PATH), JSON.stringify({ total: 0, files: baseline }));
  return dir;
}

describe("CSS rules anywhere in src/", () => {
  it("reports physical properties in any rule, with the logical fix", () => {
    const f = scanCss(".panel { margin-left: 8px; padding-right: 4px; text-align: left; }\n.x { right: 0 }\n.y{float:right}");
    expect(f.map((x: { fix: string }) => x.fix)).toEqual(["margin-inline-start", "padding-inline-end", "text-align: start", "inset-inline-end", "float: inline-end"]);
    expect(f[0].line).toBe(1);
    expect(f[3].line).toBe(2);
  });

  it("looks inside @media and nested rules, and gives the right line", () => {
    const f = scanCss("@media (max-width: 600px) {\n  .a {\n    color: red;\n    border-left: 1px solid;\n  }\n}\n.b { &:hover { margin-right: 2px } }");
    expect(f.map((x: { line: number }) => x.line)).toEqual([4, 7]);
    expect(f[0].fix).toBe("border-inline-start");
  });

  it("leaves logical, symmetric, centred and explicitly directed rules alone", () => {
    const ok = [
      ".a { margin-inline-start: 4px; inset-inline-end: 0; text-align: start }",
      ".a { left: 0; right: 0 }",
      ".a { margin-left: auto; margin-right: auto }",
      ".a { left: 50%; transform: translateX(-50%) }",
      '[dir="rtl"] .a { margin-right: 4px }',
      ".a:dir(ltr) { padding-left: 2px }",
      "@font-face { font-family: x; src: url(a.woff2) }",
      ".a { content: 'margin-left: 4px' }",
      "/* .a { margin-left: 4px } */",
    ];
    for (const css of ok) expect(scanCss(css), css).toEqual([]);
  });

  it("accepts a justified allow comment on the line or above, not a bare one", () => {
    expect(scanCss(".a {\n  /* logical-allow: the caret is drawn on the left in both directions */\n  border-left: 1px solid;\n}")).toEqual([]);
    expect(scanCss(".a { border-left: 1px solid; /* hygiene-allow: same as CodeMirror */ }")).toEqual([]);
    expect(scanCss(".a {\n  /* logical-allow: */\n  border-left: 1px solid;\n}")).toHaveLength(1);
  });
});

describe("style objects in TS and TSX", () => {
  it("reports JSX style props, CSSProperties objects, el.style and Object.assign", () => {
    const src = [
      'const A = () => <div style={{ marginLeft: 8, textAlign: "right" }} />;',
      "const s: React.CSSProperties = { paddingRight: 4 };",
      "el.style.left = `${x}px`;",
      "Object.assign(el.style, { borderRight: '1px solid' });",
      "const opts = { style: { right: 2 } };",
    ].join("\n");
    const f = scanTs("a.tsx", src);
    expect(f.map((x: { line: number; fix: string }) => `${x.line}:${x.fix}`)).toEqual([
      "1:margin-inline-start",
      "1:text-align: end",
      "2:padding-inline-end",
      "3:inset-inline-start",
      "4:border-inline-end",
      "5:inset-inline-end",
    ]);
  });

  it("ignores geometry objects that are not styles, logical keys and symmetric pairs", () => {
    const src = [
      "const rect = { left: 0, right: 10, top: 0 };",
      "const p = { marginLeft: 3 };",
      "const A = () => <div style={{ marginInlineStart: 8, insetInlineEnd: 0, left: 0, right: 0 }} />;",
      "const B = () => <div style={{ textAlign: 'start' }} />;",
    ].join("\n");
    expect(scanTs("b.tsx", src)).toEqual([]);
  });

  it("honours `// logical-allow: <reason>`", () => {
    const src = "// logical-allow: viewport coordinates from getBoundingClientRect are physical\nel.style.left = `${r.left}px`;";
    expect(scanTs("c.ts", src)).toEqual([]);
  });
});

describe("Tailwind classes", () => {
  it("reports physical utilities with their logical twin", () => {
    expect(scanClassString("ml-2 md:pr-4 !text-left hover:border-l-2 rounded-tr-md -left-1 float-right").map((x: { fix: string }) => x.fix)).toEqual([
      "ms-*",
      "pe-*",
      "text-start",
      "border-s-*",
      "rounded-se-*",
      "start-*",
      "float-end",
    ]);
  });

  it("does not confuse colours, sizes and rtl:/ltr: variants", () => {
    expect(scanClassString("border-red-500 border-lime-200 rounded-lg ms-2 pe-3 start-0 text-start rtl:ml-2 ltr:pr-1 left-0 right-0 px-2")).toEqual([]);
  });

  it("finds them in className, cn()/clsx() calls and *Class variables", () => {
    const src = [
      'const A = () => <div className="flex ml-2" />;',
      'const B = () => <div className={cn("p-1", on && "pr-4")} />;',
      'const btnClass = "text-right";',
      'const locale = "pl-PL";',
    ].join("\n");
    expect(scanTs("d.tsx", src).map((x: { line: number; text: string }) => `${x.line}:${x.text}`)).toEqual(["1:ml-2", "2:pr-4", "3:text-right"]);
  });
});

describe("the gate and its baseline", () => {
  it("fails when a new file adds margin-left", () => {
    const dir = tree({ "src/new.css": ".dialog { margin-left: 12px }" }, {});
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toMatch(/src\/new\.css:1 .*margin-left.*margin-inline-start/);
  });

  it("passes a file at its baseline count and fails one above it", () => {
    const base = { "src/a.tsx": 1 };
    expect(run(tree({ "src/a.tsx": "const A = () => <p style={{ marginLeft: 1 }} />;" }, base)).code).toBe(0);
    expect(run(tree({ "src/a.tsx": "const A = () => <p style={{ marginLeft: 1, paddingRight: 2 }} />;" }, base)).code).toBe(1);
  });

  it("fails when a file drops below the baseline until --update records the lower number", () => {
    const dir = tree({ "src/a.css": ".a { color: red }", "src/b.css": ".b { right: 1px }" }, { "src/a.css": 2, "src/b.css": 1 });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toMatch(/below the baseline[\s\S]*src\/a\.css: 0 now, baseline 2/);
    const u = run(dir, { update: true });
    expect(u.code).toBe(0);
    const saved = JSON.parse(readFileSync(join(dir, BASELINE_PATH), "utf8"));
    expect(saved).toMatchObject({ total: 1, files: { "src/b.css": 1 } });
    expect(run(dir).code).toBe(0);
  });

  it("--update never raises the baseline", () => {
    const dir = tree({ "src/a.css": ".a { right: 1px; margin-left: 2px }" }, { "src/a.css": 1 });
    const r = run(dir, { update: true });
    expect(r.code).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, BASELINE_PATH), "utf8")).files["src/a.css"]).toBe(1);
  });

  it("fails when there is nothing to scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "logical-css-empty-"));
    expect(run(dir).code).toBe(1);
  });

  it("skips tests, stories and declarations", () => {
    const dir = tree({ "src/ok.css": ".a{}", "src/__tests__/x.test.tsx": "<p style={{ marginLeft: 1 }} />", "src/x.d.ts": "", "src/y.stories.tsx": "<p className='ml-2' />" }, {});
    expect(run(dir).code).toBe(0);
  });

  it("the repository is at or below its recorded baseline", () => {
    const r = run(ROOT);
    expect(r.lines.join("\n")).toMatch(/files scanned; \d+ physical properties, all in the baseline \(\d+\)/);
    expect(r.code).toBe(0);
    const saved = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), "utf8"));
    expect(saved.total).toBe(Object.values(saved.files as Record<string, number>).reduce((a, b) => a + b, 0));
  });

  it("the new gate runs in npm run hygiene", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.hygiene).toContain("node scripts/check-logical-css.mjs");
  });

  it("reports shorthands that set the two sides differently, like 9.3 does", () => {
    expect(scanCss(".a { margin: 0 1rem 0 2rem }").map((x: { fix: string }) => x.fix)).toEqual(["margin-block + margin-inline-start / margin-inline-end"]);
    expect(scanCss(".a { border-radius: 0 6px 6px 0 }")).toHaveLength(1);
    expect(scanCss(".a { margin: 0 auto; padding: 1px 2px 3px 2px; border-radius: 4px; inset: 0 }")).toEqual([]);
    expect(scanTs("s.tsx", "const A = () => <i style={{ padding: '0 4px 0 8px' }} />;")).toHaveLength(1);
  });

  it("covers the 9.3 editor/preview scope too (no regression)", () => {
    expect(physicalFix("margin-left", "1px")).toBe("margin-inline-start");
    const dir = tree({ "src/x.css": ".prose-lumen blockquote { border-left: 3px solid }" }, {});
    cpSync(join(dir, "src/x.css"), join(dir, "src/y.css"));
    expect(run(dir).code).toBe(1);
  });
});
