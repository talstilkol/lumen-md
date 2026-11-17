/**
 * W11.S18, wave g5: the desktop-updates page tells the truth about the
 * isolation app's allow-list. It said two commands were missing; twelve
 * were. The list the page names is checked against the code: the commands
 * src-tauri/src/lib.rs registers that src-tauri/isolation/index.js does not
 * allow. When the owner updates the allow-list, this asks for the page to
 * stop saying anything is missing.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error -- plain .mjs module without type declarations
import { isolationCommands, rustCommands } from "../../scripts/tauri-isolation.mjs";

const PAGES = ["docs/src/content/docs/getting-started/desktop-updates.md", "docs/src/content/docs/he/getting-started/desktop-updates.md"];

describe("the isolation allow-list, as the docs describe it", () => {
  const allowed = new Set<string>(isolationCommands("."));
  const missing = (rustCommands(".") as string[]).filter((c) => !allowed.has(c)).sort();

  it("reads both lists from the code", () => {
    expect(allowed.size).toBeGreaterThan(10);
    expect((rustCommands(".") as string[]).length).toBeGreaterThan(allowed.size - 1);
  });

  for (const page of PAGES)
    it(`${page.includes("/he/") ? "Hebrew" : "English"} page: names every missing command and how many there are`, () => {
      const text = readFileSync(page, "utf8");
      if (missing.length === 0) {
        expect(text).not.toMatch(/lacks \d+ commands|חסרות \d+ פקודות/);
        return;
      }
      for (const c of missing) expect(text, c).toContain(`\`${c}\``);
      expect(text).toMatch(new RegExp(page.includes("/he/") ? `חסרות ${missing.length} פקודות` : `lacks ${missing.length} commands`));
    });
});
