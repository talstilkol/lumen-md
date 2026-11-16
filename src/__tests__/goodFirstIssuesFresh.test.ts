// @vitest-environment node
/**
 * W10.E63 (audit r3): docs/dev/good-first-issues.md pointed at files that
 * were deleted (items 2, 9–12) and at a bug already fixed (item 1). Every
 * item must stay real: each file its "where" names exists, and an item that
 * says its finding is in the lint baseline names a file that is still there.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const DOC = readFileSync(join(ROOT, "docs/dev/good-first-issues.md"), "utf8");
const BASELINE = JSON.parse(readFileSync(join(ROOT, "eslint-suppressions.json"), "utf8")) as Record<string, unknown>;
const items = DOC.split(/^(?=### \d+\. )/m).filter((s) => /^### \d+\. /.test(s));

describe("good first issues are open issues (W10.E63)", () => {
  it("has 15 items, each with an English title for its GitHub issue", () => {
    expect(items).toHaveLength(15);
    for (const it of items) expect(it, it.split("\n")[0]).toMatch(/^\*\([A-Z][^)]+\)\*$/m);
  });

  it("every file an item's 'where' names exists, and a baseline finding is still in the baseline", () => {
    const problems: string[] = [];
    for (const item of items) {
      const head = item.split("\n")[0];
      const where = /\*\*איפה:\*\*([\s\S]*?)(?=\n- \*\*|\n\n)/.exec(item)?.[1] ?? "";
      const files = [...where.matchAll(/`((?:src|e2e|scripts)\/[^`:]+?)(?::[\d-]+)?`/g)].map((m) => m[1]);
      if (!files.length) problems.push(`${head}: names no file`);
      for (const f of files) if (!existsSync(join(ROOT, f))) problems.push(`${head}: ${f} does not exist`);
      if (/baseline/.test(where) && /eslint|jsx-a11y|no-|react-hooks|@typescript/.test(where)) {
        const src = files.find((f) => f.startsWith("src/"));
        if (src && !(src in BASELINE)) problems.push(`${head}: ${src} has no lint baseline entry any more (done?)`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("item 1's old bug (Excalidraw in the trash-undo EDITING selector) is not listed again", () => {
    expect(DOC).not.toMatch(/trashUndoShortcut\.ts/);
  });
});
