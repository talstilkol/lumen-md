// @vitest-environment node
/**
 * Plan W13.H3 — mirror an icon only when it shows a direction. Every
 * lucide-react icon the interface imports is classified in
 * src/ui/icons/direction.json; directional ones carry `icon-dir`, which
 * mirrors under RTL; fixed ones never do.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { scanIcons, scanIconFile, readDirection, DIRECTION_JSON } from "../../scripts/lib/iconDirection.mjs";
import { dirIcon, iconDirClass, ICON_DIR } from "../ui/icons/direction";
import { cmdIcons } from "../ui/cmdIcons";

const ROOT = resolve(__dirname, "..", "..");
const DIR = readDirection(ROOT);
type Problem = { file?: string; line: number; rule: string; text: string };
const scan = (src: string): Problem[] => scanIconFile("x.tsx", src, DIR).problems;
const rules = (src: string) => scan(src).map((p) => p.rule);

describe("the classification", () => {
  const r = scanIcons(ROOT);

  it("scans the real tree (not an empty one)", () => {
    expect(r.files).toBeGreaterThan(500);
    expect(r.imports.size).toBeGreaterThan(80);
  });

  it("classifies 100% of the icons the interface imports", () => {
    const unclassified = [...r.imports.keys()].filter((n: string) => !DIR.directional.has(n) && !DIR.fixed.has(n));
    expect(unclassified).toEqual([]);
  });

  it("puts no icon in both lists and lists none that nothing imports", () => {
    expect(r.both).toEqual([]);
    expect(r.stale).toEqual([]);
  });

  it("gives a reason for every entry", () => {
    for (const k of ["directional", "fixed"] as const) for (const [n, why] of Object.entries(DIR.raw[k] as Record<string, string>)) expect(why.length, `${k}.${n}`).toBeGreaterThan(5);
  });

  it("follows the bidirectionality rules for the well-known cases", () => {
    for (const n of ["ArrowLeft", "ChevronLeft", "ChevronRight", "Undo2", "Redo2", "Reply", "List", "PanelRightOpen", "LogOut"]) expect(DIR.directional.has(n), n).toBe(true);
    for (const n of ["Play", "Check", "Loader2", "History", "Search", "Code2", "Terminal", "ChevronDown", "X", "RefreshCw"]) expect(DIR.fixed.has(n), n).toBe(true);
  });

  it("every directional use in the code carries icon-dir and nothing is flipped by hand", () => {
    expect(r.problems).toEqual([]);
  });
});

describe("the checker", () => {
  it("fails a new icon that is in neither list", () => {
    expect(rules('import { Rocket } from "lucide-react";\nexport const A = () => <Rocket />;')).toEqual(["unclassified"]);
  });

  it("fails a directional icon without icon-dir, passes it with the class or a reason", () => {
    const imp = 'import { Undo2, ChevronRight as Next } from "lucide-react";\n';
    expect(rules(imp + "const A = () => <Undo2 size={14} />;")).toEqual(["missing-icon-dir"]);
    expect(rules(imp + "const A = () => <Next />;")).toEqual(["missing-icon-dir"]);
    expect(rules(imp + 'const A = () => <><Undo2 className="icon-dir" /><Next className={cn("x", "icon-dir")} /></>;')).toEqual([]);
    expect(rules(imp + 'const A = () => <Next data-icon-fixed="points at the physical right edge of the page" />;')).toEqual([]);
  });

  it("fails a fixed icon that mirrors", () => {
    expect(rules('import { Play } from "lucide-react";\nconst A = () => <Play className="icon-dir" />;')).toEqual(["fixed-mirrored"]);
  });

  it("fails a directional icon passed as a value unless it goes through dirIcon()", () => {
    const imp = 'import { ChevronLeft, ChevronRight } from "lucide-react";\n';
    expect(rules(imp + "const Prev = rtl ? ChevronRight : ChevronLeft;")).toEqual(["unwrapped-value", "unwrapped-value"]);
    expect(rules(imp + "export const icons = { ChevronLeft };")).toEqual(["unwrapped-value"]);
    expect(rules(imp + "export const icons = { prev: dirIcon(ChevronLeft), ChevronRight: dirIcon(ChevronRight) };")).toEqual([]);
  });

  it("fails an icon flipped by hand with scaleX(-1)", () => {
    expect(rules('import { ArrowLeft } from "lucide-react";\nconst A = () => <ArrowLeft className="icon-dir" style={{ transform: rtl ? "scaleX(-1)" : undefined }} />;')).toEqual(["manual-flip"]);
  });

  it("ignores components with an icon's name that do not come from lucide-react", () => {
    expect(rules('import { Quote } from "./Quote";\nconst A = () => <Quote text="x" />;')).toEqual([]);
  });
});

describe("runtime: dirIcon and the palette", () => {
  it("marks a component and answers the class for it only", () => {
    const A = () => null;
    const B = () => null;
    dirIcon(A);
    expect(iconDirClass(A)).toBe(ICON_DIR);
    expect(iconDirClass(B)).toBeUndefined();
    expect(iconDirClass(undefined)).toBeUndefined();
  });

  it("the command icons that show a direction are marked, the others are not", () => {
    expect(iconDirClass(cmdIcons.PanelRightOpen)).toBe("icon-dir");
    expect(iconDirClass(cmdIcons.Quote)).toBe("icon-dir");
    expect(iconDirClass(cmdIcons.Download)).toBeUndefined();
    expect(iconDirClass(cmdIcons.Youtube)).toBeUndefined();
  });

  it("the palette renders a command icon with iconDirClass", () => {
    expect(readFileSync(join(ROOT, "src/ui/CommandPalette.tsx"), "utf8")).toMatch(/<Icon [^>]*className=\{iconDirClass\(Icon\)\}/);
  });
});

describe("the stylesheet", () => {
  const css = readFileSync(join(ROOT, "src/index.css"), "utf8");

  it("mirrors .icon-dir under RTL with `scale`, which keeps a rotate transform", () => {
    expect(css).toMatch(/\.icon-dir:dir\(rtl\)\s*\{\s*scale:\s*-1 1;\s*\}/);
  });

  it("never mirrors every icon blindly", () => {
    const sheets: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith(".css")) sheets.push(readFileSync(p, "utf8"));
      }
    };
    walk(join(ROOT, "src"));
    const blind = /(\[dir=["']?rtl["']?\]|:dir\(rtl\))[^{}]*(\bsvg\b|\.lucide\b)[^{}]*\{[^}]*(scaleX\(-1\)|scale:\s*-1)/;
    for (const s of sheets) expect(s).not.toMatch(blind);
  });

  it("the classification file sits where the checker reads it", () => {
    expect(DIRECTION_JSON).toBe("src/ui/icons/direction.json");
  });
});
