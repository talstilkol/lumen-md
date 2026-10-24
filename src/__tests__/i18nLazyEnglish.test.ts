/**
 * English of lazily loaded domains (src/i18n/lazy/<domain>.json): kept out
 * of the startup bundle, registered when the domain's chunk loads.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { lazyEnglish, LAZY_DIR } from "./helpers/i18nLazy";
import { registerEnglish, t } from "../i18n";

const SRC = resolve(__dirname, "..");

/**
 * Each lazy file, the one strings module that imports it, and the modules
 * allowed to import that strings module — all of them reached only through
 * a dynamic import, so the strings never join the startup bundle.
 */
const DOMAINS: Record<string, { module: string; users: string[]; prefixes: string[] }> = {
  "caption.json": { module: "ai/captionStrings.ts", users: ["ai/caption.ts"], prefixes: ["caption."] },
  "mt.json": { module: "ai/mt/strings.ts", users: ["ai/mt/index.ts", "agents/commands.ts"], prefixes: ["models.", "mt.", "toast.translatedWith", "toast.localMtUnavailable"] },
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");

describe("i18n: lazy English", () => {
  const lazy = lazyEnglish();
  const index = readFileSync(join(SRC, "i18n", "index.ts"), "utf8");
  const files = sources(SRC);

  it("every lazy file is declared, and none of its keys is also in the startup bundle", () => {
    expect(readdirSync(LAZY_DIR).sort()).toEqual(Object.keys(DOMAINS).sort());
    expect(Object.keys(lazy).length).toBeGreaterThan(10);
    for (const k of Object.keys(lazy)) expect(index.includes(`"${k}":`), k).toBe(false);
  });

  it("keys stay inside their domain's prefixes", () => {
    for (const [file, d] of Object.entries(DOMAINS)) {
      const keys = Object.keys(JSON.parse(readFileSync(join(LAZY_DIR, file), "utf8")) as Record<string, string>);
      for (const k of keys) expect(d.prefixes.some((p) => k.startsWith(p)), `${file}: ${k}`).toBe(true);
    }
  });

  it("each file is imported only by its strings module, and that module only by its declared users", () => {
    for (const [file, d] of Object.entries(DOMAINS)) {
      const importers = files.filter((f) => readFileSync(f, "utf8").includes(`i18n/lazy/${file}`)).map(rel);
      expect(importers).toEqual([d.module]);
      const stem = d.module.replace(/\.ts$/, "");
      const users = files
        .filter((f) => f !== join(SRC, d.module))
        .filter((f) => {
          const src = readFileSync(f, "utf8");
          return [...src.matchAll(/import\s+(?:[^"']*from\s+)?["']([^"']+)["']/g)].some((m) => {
            if (!m[1].startsWith(".")) return false;
            return rel(resolve(join(f, ".."), m[1])) === stem;
          });
        })
        .map(rel)
        .sort();
      expect(users).toEqual([...d.users].sort());
    }
  });

  it("the declared users are themselves only loaded with a dynamic import", () => {
    for (const d of Object.values(DOMAINS)) {
      for (const u of d.users) {
        const stem = u.replace(/\.tsx?$/, "");
        for (const f of files) {
          if (rel(f) === u) continue;
          const src = readFileSync(f, "utf8");
          for (const m of src.matchAll(/^\s*import\s+(?!type\b)(?:[^"';]*from\s+)?["']([^"']+)["']/gm)) {
            if (!m[1].startsWith(".")) continue;
            expect(rel(resolve(join(f, ".."), m[1])) === stem, `${rel(f)} imports ${u} statically`).toBe(false);
          }
        }
      }
    }
  });

  it("registerEnglish makes t() resolve the keys, without replacing existing English", async () => {
    await import("../ai/mt/strings");
    expect(t("mt.layer.name.opus")).toBe(lazy["mt.layer.name.opus"]);
    expect(t("toast.translatedWith", { layer: "X" })).toBe("Translated with X");
    registerEnglish({ "dialog.ok": "replaced?", "test.lazy.only": "lazy" });
    expect(t("dialog.ok")).toBe("OK");
    expect(t("test.lazy.only")).toBe("lazy");
  });
});
