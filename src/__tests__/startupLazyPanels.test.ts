/**
 * W10.E19 (plan 8.2, W4.9) — what the startup path no longer carries:
 *  - every dialog and panel that is hidden at start is a lazy import in
 *    App.tsx, rendered only once it is open (or opened once);
 *  - nothing on the eager path imports such a module for a value (the
 *    command icons moved out of the palette for that);
 *  - one boot script instead of three;
 *  - the startup budget is 380 KB (it only goes down).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// App.tsx and its lazy panel table, src/appPanels.ts (split from App.tsx for the 800-line limit, W10.E31).
const app = read("src/App.tsx") + "\n" + read("src/appPanels.ts");

/** Hidden at start: shown by a command, a shortcut or a toggle that is off by default. */
const HIDDEN = {
  CommandPalette: "ui/CommandPalette",
  SearchDialog: "ui/SearchDialog",
  BacklinksPanel: "ui/BacklinksPanel",
  TagsPanel: "ui/TagsPanel",
  GraphOverlay: "ui/GraphOverlay",
  FocusMode: "ui/FocusMode",
  CommentsPanel: "ui/CommentsPanel",
  SettingsScreen: "ui/SettingsScreen",
  VersionHistory: "ui/VersionHistory",
  PropertiesPanel: "ui/PropertiesPanel",
  TrashPanel: "ui/TrashPanel",
  PrivacyLedgerPanel: "ui/PrivacyLedgerPanel",
  QuickCapture: "ui/QuickCapture",
  ImportWizard: "storage/import/ImportWizard",
  RuntimeMetricsPanel: "ui/RuntimeMetricsPanel",
} as const;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
  });
}

describe("startup: hidden dialogs and panels are lazy (W10.E19)", () => {
  for (const [name, mod] of Object.entries(HIDDEN)) {
    it(`${name} is a lazy import and has no static one`, () => {
      expect(app, name).toMatch(new RegExp(`const ${name} = lazy\\(\\s*\\(\\) =>\\s*import\\("\\./${mod}"\\)`));
      expect(app).not.toMatch(new RegExp(`^import \\{[^}]*\\b${name}\\b[^}]*\\} from "\\./${mod}";`, "m"));
    });
  }

  it("is rendered only while open, or once opened (state kept after a close)", () => {
    expect(app).toMatch(/\{paletteMounted && <Suspense fallback=\{null\}>\s*<CommandPalette/);
    expect(app).toMatch(/\{tagsMounted && <Suspense fallback=\{null\}><TagsPanel/);
    expect(app).toMatch(/\{showBacklinks && \(\s*<Suspense fallback=\{null\}>\s*<BacklinksPanel/);
    expect(app).toMatch(/\{graphOpen && \(\s*<Suspense fallback=\{null\}>\s*<GraphOverlay/);
    expect(app).toMatch(/\{focusMode && \(\s*<Suspense fallback=\{null\}>\s*<FocusMode/);
  });

  it("no production module imports a lazy one for a value (type imports are erased)", () => {
    const offenders: string[] = [];
    for (const file of files(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      const text = readFileSync(file, "utf8");
      for (const mod of Object.values(HIDDEN)) {
        const base = mod.split("/").pop()!;
        const re = new RegExp(`^import (?!type )[^;]*from "[./]*(?:[\\w/]*/)?${base}";`, "gm");
        if (rel.endsWith(`${mod}.tsx`) || rel.endsWith(`${mod}.ts`)) continue;
        for (const m of text.matchAll(re)) offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the command icons have their own module", () => {
    expect(read("src/ui/cmdIcons.ts")).toMatch(/export const cmdIcons = \{/);
    expect(read("src/ui/CommandPalette.tsx")).not.toMatch(/export const cmdIcons/);
  });
});

describe("startup: one boot script, and the 380 KB budget (W10.E19)", () => {
  it("public/boot.js replaces theme-boot, locale-boot and note-boot", () => {
    expect(existsSync(join(ROOT, "public/boot.js"))).toBe(true);
    for (const f of ["theme-boot.js", "locale-boot.js", "note-boot.js"]) expect(existsSync(join(ROOT, "public", f)), f).toBe(false);
    const html = read("index.html");
    expect([...html.matchAll(/<script src="\/([^"]+)"><\/script>/g)].map((m) => m[1])).toEqual(["boot.js"]);
  });

  it("the startup budget is at most 380 KB", () => {
    const spec = JSON.parse(read("scripts/bundle-budgets.json")) as { startup: { budgetKb: number } };
    expect(spec.startup.budgetKb).toBeLessThanOrEqual(380);
  });
});
