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
import { READING_MODES } from "../reading/modes";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/** The `data-reading-mode` ids written in source files (tests left out), by file. */
export function modeRootsIn(dir: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/__tests__|\.test\./.test(f));
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/data-reading-mode[=:]\s*["']([\w-]+)["']/g)) {
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

  it("the scan finds an unregistered root (the gate's own check)", () => {
    const fake = new Map(roots);
    fake.set("rsvp", ["src/reading/rsvp.tsx"]);
    expect([...fake.keys()].filter((id) => !ids.includes(id))).toEqual(["rsvp"]);
  });
});
