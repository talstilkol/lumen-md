/**
 * Plan W10.B23 (audit W7.10, 4.16): a code comment is a claim too. These
 * two described capabilities the shipped code doesn't have; they now say
 * what is true, and stay true while the facts below hold.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") srcFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("comments that claim a capability (W10.B23)", () => {
  it("voice-corpus: no 'recorded in the app' while nothing in src/ imports it", () => {
    const users = srcFiles("src").filter((f) => !f.includes("voice-corpus") && /from ["'][./]*.*voice-corpus/.test(readFileSync(f, "utf8")));
    const corpus = readFileSync("src/voice-corpus/corpus.ts", "utf8");
    if (users.length === 0) {
      expect(corpus).not.toMatch(/recorded in the app/);
      expect(corpus).toMatch(/NO recorder in the app yet/);
    }
  });

  it("desktopShortcut: says it does nothing while the global-shortcut plugin is not in the build", () => {
    const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
    const src = readFileSync("src/capture/desktopShortcut.ts", "utf8");
    if (!/tauri-plugin-global-shortcut/.test(cargo)) {
      expect(src).toMatch(/TODAY IT DOES NOTHING/);
      expect(src.slice(0, 400)).not.toMatch(/\* The desktop app's system-wide capture shortcut \(plan 4\.16\): ⌥⌘N on macOS\n \* brings Lumen/);
    }
  });
});
