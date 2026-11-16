/**
 * R12.10 — the contradiction finder is reachable from the product: the
 * palette's "Where my notes disagree" command (entities.contradictions)
 * reads the workspace, finds the planted contradiction, stages one report
 * note in the review queue, opens the review panel and writes nothing. A
 * failing vault read ends in an error toast and stages nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const writes: string[] = [];
let failList = false;
vi.mock("../storage/workspace", () => ({
  listWorkspace: async () => {
    if (failList) throw new Error("no folder open");
    return [...files.keys()].map((path) => ({ path }));
  },
  readWorkspaceFile: async (p: string) => files.get(p)!,
  workspaceHasFile: async (p: string) => files.has(p),
  writeWorkspaceFile: async (p: string) => void writes.push(p),
}));

const toasts: Array<{ message: string; type: string }> = [];
vi.mock("../ui/AiToast", () => ({ showAiToast: (message: string, type = "info") => void toasts.push({ message, type }) }));

import { buildEntityCommands } from "../commands/domains/entities";
import type { CommandContext } from "../commands/domains/context";
import { clearStagedChanges, listStagedChanges } from "../agents/staging";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const command = () => buildEntityCommands({} as CommandContext).find((c) => c.id === "entities.contradictions")!;

describe("R12.10: the palette command runs the contradictor", () => {
  let opened = 0;
  const onOpen = () => void opened++;
  beforeEach(() => {
    clearStagedChanges();
    localStorage.clear();
    files.clear();
    writes.length = 0;
    failList = false;
    toasts.length = 0;
    opened = 0;
    window.addEventListener("lumen-open-agent-review", onOpen);
  });
  afterEach(() => {
    window.removeEventListener("lumen-open-agent-review", onOpen);
    clearStagedChanges();
  });

  it("is in the palette, stages one report with the planted contradiction, opens the review panel and writes nothing", async () => {
    files.set("אנשים/דנה לוי.md", "# דנה לוי\n");
    files.set("יומן/א.md", "דנה לוי נולדה ב-1980 בחיפה.\n");
    files.set("תיק/ב.md", "דנה לוי נולדה בשנת 1982.\n");
    const cmd = command();
    expect(cmd).toBeTruthy();
    await cmd.action();
    const staged = listStagedChanges();
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({ kind: "file", path: `סתירות/${today()}.md`, status: "pending", agentId: "contradictor" });
    const report = (staged[0] as { after: string }).after;
    expect(report).toContain("דנה לוי נולדה ב-1980 בחיפה");
    expect(report).toContain("דנה לוי נולדה בשנת 1982");
    expect(opened).toBe(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("info");
    expect(toasts[0].message).toMatch(/1/);
    expect(writes).toEqual([]);
  });

  it("a vault that cannot be read: an error toast, nothing staged, no panel", async () => {
    failList = true;
    await command().action();
    expect(listStagedChanges()).toEqual([]);
    expect(opened).toBe(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].message).toMatch(/^Could not look for disagreements/);
  });
});
