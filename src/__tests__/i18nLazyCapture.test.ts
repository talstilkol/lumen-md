/**
 * English of lazily loaded domains (src/i18n/lazy/<domain>.json): kept out
 * of the startup bundle, registered when the domain's chunk loads. Here: the
 * quick / voice capture strings (plan W1.13 — the voice button pushed the
 * startup total over its 460 KB budget).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { lazyEnglish } from "./helpers/i18nLazy";
import { registerEnglish, t } from "../i18n";

const SRC = resolve(__dirname, "..");

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

describe("i18n: lazy English for capture", () => {
  const lazy = lazyEnglish();
  const index = readFileSync(join(SRC, "i18n", "index.ts"), "utf8");
  const files = sources(SRC).map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") }));

  it("has the capture strings, none of them duplicated in the startup bundle", () => {
    const capture = Object.keys(lazy).filter((k) => k.startsWith("capture."));
    expect(capture.length).toBeGreaterThanOrEqual(15);
    expect(capture).toContain("capture.voice.start");
    for (const k of Object.keys(lazy)) expect(index.includes(`"${k}":`), k).toBe(false);
    // The palette and the shortcuts list show the title at startup.
    expect(index.includes(`"capture.title":`)).toBe(true);
    expect(lazy["capture.title"]).toBeUndefined();
  });

  it("capture.json is imported only by src/capture/strings.ts", () => {
    const importers = files.filter((f) => f.text.includes("i18n/lazy/capture.json")).map((f) => f.path);
    expect(importers).toEqual(["capture/strings.ts"]);
  });

  it("the strings module is used only by modules that load on demand", () => {
    const users = files
      .filter((f) => /import "(\.\/|\.\.\/capture\/)strings";/.test(f.text))
      .map((f) => f.path)
      .sort();
    expect(users).toEqual(["capture/quickCapture.ts", "ui/QuickCapture.tsx"]);
    // …and neither of them is imported statically from outside capture.
    for (const f of files) {
      if (f.path.startsWith("capture/") || f.path === "ui/QuickCapture.tsx") continue;
      expect(/^import [^;]*from "[./]*(capture\/quickCapture|ui\/QuickCapture)";/m.test(f.text), f.path).toBe(false);
    }
  });

  it("registerEnglish makes t() resolve the keys, without replacing existing English", async () => {
    await import("../capture/strings");
    expect(t("capture.voice.start")).toBe(lazy["capture.voice.start"]);
    expect(t("capture.saved", { path: "inbox.md" })).toBe("Added to inbox.md");
    registerEnglish({ "capture.title": "replaced?", "test.lazy.capture": "lazy" });
    expect(t("capture.title")).toBe("Quick capture");
    expect(t("test.lazy.capture")).toBe("lazy");
  });
});
