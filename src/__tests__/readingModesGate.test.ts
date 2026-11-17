/**
 * W13.R13: the reading-modes gate's registry is complete. Every
 * `data-reading-mode="…"` root in the code is registered in
 * src/reading/modes.ts, every registered mode has its root in the file it
 * names and a command the palette has, and the e2e gate
 * (e2e/reading-modes.spec.ts) loops over the registry rather than a list of
 * its own. A new mode that is not registered fails here.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_GATE, MODE_DEFS, READING_MODES } from "../reading/modes";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/** The three ways to write a root (src/reading/modeRoot.ts): the attribute, `modeRoot("id")`, `setModeRoot(el, "id")`. */
export const ROOT_MARK = /(?:data-reading-mode[=:]\s*|\bmodeRoot\(\s*|\bsetModeRoot\([^,()]+,\s*)["']([\w-]+)["']/g;

/** The `data-reading-mode` ids written in source files (tests left out), by file. */
export function modeRootsIn(dir: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/__tests__|\.test\./.test(f));
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(ROOT_MARK)) {
      const list = out.get(m[1]) ?? [];
      list.push(`src/${f.replace(/\\/g, "/")}`);
      out.set(m[1], list);
    }
  }
  return out;
}

describe("reading modes gate: the registry (W13.R13)", () => {
  const roots = modeRootsIn(SRC);
  const ids = READING_MODES.map((m) => m.id);

  it("ids are unique", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every mode root in the code is registered", () => {
    const unregistered = [...roots.keys()].filter((id) => !ids.includes(id));
    expect(unregistered).toEqual([]);
  });

  it("every registered mode has its root in the file it names", () => {
    for (const m of READING_MODES) expect(roots.get(m.id) ?? [], m.id).toContain(m.file);
  });

  it("every registered command exists in the palette", () => {
    const domains = readdirSync(join(SRC, "commands", "domains")).map((f) => readFileSync(join(SRC, "commands", "domains", f), "utf8")).join("\n");
    for (const m of READING_MODES) if ("command" in m.open) expect(domains, m.id).toContain(`id: "${m.open.command}"`);
  });

  it("the e2e gate loops over this registry, in both directions and in WebKit", () => {
    const spec = readFileSync(join(ROOT, "e2e", "reading-modes.spec.ts"), "utf8");
    expect(spec).toMatch(/from "\.\.\/src\/reading\/modes"/);
    expect(spec).toMatch(/for \(const mode of READING_MODES\)/);
    expect(spec).toMatch(/\["he", "en"\]/);
  });

  it("every wave-13 reading mode is registered: R2, R3, R5–R12 and focus (INT7)", () => {
    const plans = READING_MODES.map((m) => m.plan);
    for (const p of ["W5.6", "W13.R2", "W13.R3", "W13.R5", "W13.R6", "W13.R7", "W13.R8", "W13.R9", "W13.R10", "W13.R11", "W13.R12"]) expect(plans, p).toContain(p);
    expect(ids).toEqual(expect.arrayContaining(["focus", "focus-layer", "rsvp", "immersive", "book-spread", "triple", "compare", "sidenotes", "page-view", "daf", "bilingual"]));
  });

  it("the Reading mode menu offers only registered modes, and the gate opens the menu's own ones through it (INT7)", () => {
    for (const d of MODE_DEFS) {
      const entry = READING_MODES.find((m) => m.id === MENU_GATE[d.id]);
      expect(entry, d.id).toBeDefined();
      if ("menu" in entry!.open) expect(entry!.open.menu).toBe(d.id);
    }
    for (const m of READING_MODES) if ("menu" in m.open) expect(MODE_DEFS.map((d) => d.id), m.id).toContain(m.open.menu);
  });

  it("a mode opened through an e2e hook names a module the hooks load (INT7)", () => {
    const hooks = readFileSync(join(SRC, "testing", "e2eHooks.ts"), "utf8");
    for (const m of READING_MODES) if ("hook" in m.open) expect(hooks, m.id).toContain(`"${m.open.hook}": () => import(`);
  });

  it("the scan reads all three ways of writing a root (INT7)", () => {
    const probe = [`<div data-reading-mode="a" />`, `<div {...modeRoot("b", on)} />`, `setModeRoot(root, "c");`, `clearModeRoot(root, "d");`].join("\n");
    expect([...probe.matchAll(ROOT_MARK)].map((m) => m[1])).toEqual(["a", "b", "c"]);
  });

  it("the scan finds an unregistered root (the gate's own check)", () => {
    const fake = new Map(roots);
    // (RSVP is registered now, INT7: the probe is a mode no one wrote.)
    fake.set("speed-read", ["src/reading/speedRead.tsx"]);
    expect([...fake.keys()].filter((id) => !ids.includes(id))).toEqual(["speed-read"]);
  });
});
