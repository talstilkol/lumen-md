/**
 * The e2e specs are ES modules (package.json "type": "module"), so a bare
 * `__dirname` or `__filename` throws when Playwright loads the file — and one
 * such file empties the whole `playwright test --list` (INT7: three wave-g3
 * specs did; #1094 had fixed the same for the suite before). Use
 * `fileURLToPath(new URL(".", import.meta.url))`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const E2E = join(__dirname, "..", "..", "e2e");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("e2e specs load as ES modules (INT7)", () => {
  it("no spec or helper uses __dirname or __filename", () => {
    const files = (readdirSync(E2E, { recursive: true }) as string[]).filter((f) => /\.(ts|mts|js|mjs)$/.test(f));
    expect(files.length).toBeGreaterThan(50);
    const bad = files.filter((f) => /\b__(dirname|filename)\b/.test(code(readFileSync(join(E2E, f), "utf8"))));
    expect(bad).toEqual([]);
  });
});
