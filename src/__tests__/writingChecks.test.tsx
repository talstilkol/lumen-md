/**
 * The L5 writing checkers in the app (W13.W6–W10): the palette commands run
 * on a vault and the open note, and everything ends in the review panel —
 * replacements as staged range changes (accept or reject each), comments as
 * one staged report note. Nothing is written before an approval; the panel
 * is axe clean in Hebrew and English.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import axe from "axe-core";

const files = new Map<string, string>();
const writes: string[] = [];
vi.mock("../storage/workspace", () => ({
  isOPFSAvailable: () => true,
  listWorkspace: async () => [...files.keys()].map((path) => ({ path, name: path.split("/").pop() })),
  readWorkspaceFile: async (p: string) => {
    if (!files.has(p)) throw new Error("ENOENT");
    return files.get(p)!;
  },
  writeWorkspaceFile: async (p: string, c: string) => {
    writes.push(p);
    files.set(p, c);
  },
  workspaceHasFile: async (p: string) => files.has(p),
  workspaceHasEntry: async (p: string) => [...files.keys()].some((k) => k === p || k.startsWith(`${p}/`)),
  deleteWorkspaceFile: async (p: string) => void files.delete(p),
  isAssetName: () => false,
}));
vi.mock("../storage/workspaceIndex", () => ({
  ensureIndex: async () => {},
  indexedNotes: async () => [...files].filter(([p]) => p.endsWith(".md")).map(([path, content]) => ({ path, content })),
  searchWorkspace: async () => [],
  indexedFiles: () => [],
}));
const toasts: string[] = [];
vi.mock("../ui/AiToast", () => ({ showAiToast: (m: string) => toasts.push(m) }));

import { approveStagedChange, clearStagedChanges, listStagedChanges } from "../agents/staging";
import { argumentFlow, consistencyFlow, harperFlow, readabilityFlow, readabilityLine, reportLabels, structureFlow } from "../commands/domains/writingChecksActions";
import { buildWritingCheckCommands } from "../commands/domains/writingChecks";
import { MAX_STAGED, REPORT_DIR, renderLink, stageWritingSuggestions } from "../agents/writingReview";
import { AgentReviewPanel } from "../ui/AgentReviewPanel";
import { entityNotePath } from "../entities/model";
import type { CommandContext } from "../commands/domains/context";
import type { WritingSuggestion } from "../agents/writing/suggestionShape";

const ctxFor = (content: string, workspaceName?: string) => ({ getEditorView: () => null, liveDoc: () => ({ name: "n.md", content, workspaceName }) as never });

beforeEach(() => {
  files.clear();
  writes.length = 0;
  toasts.length = 0;
  clearStagedChanges();
});
afterEach(() => clearStagedChanges());

describe("the palette", () => {
  it("L5's five commands, then L6's four, in one builder; each one lazy (the action loads its chunk)", () => {
    const cmds = buildWritingCheckCommands({ getEditorView: () => null, liveDoc: () => ({}) } as unknown as CommandContext);
    expect(cmds.map((c) => c.id)).toEqual(["writing.consistency", "writing.structure", "writing.argument", "writing.readability", "writing.harper", "writing.repetition", "writing.loanwords", "writing.explainChange", "writing.goals"]);
    for (const c of cmds.slice(0, 5)) {
      expect(c.label).toMatch(/^Writing: /);
      expect(c.hint?.length).toBeGreaterThan(20);
    }
  });
});

describe("W13.W6 in the app: the vault, then the review panel", () => {
  beforeEach(() => {
    files.set(entityNotePath({ type: "place", name: "ירושלים" }), "---\nentity-type: place\naliases: [Jerusalem]\n---\n\n# ירושלים\n");
    files.set(entityNotePath({ type: "organization", name: "הטכניון" }), "---\nentity-type: organization\n---\n\n# הטכניון\n");
    files.set("a.md", "# א\n\nהטכניון נוסד ב-1912 בחיפה.\n\nביקרנו בירושלים, וירושלים יפה.\n");
    files.set("b.md", "# ב\n\nהטכניון נוסד בשנת 1924.\n\nבירושלם העתיקה יש סמטאות.\n");
    files.set("מילון מונחים.md", "- דוא״ל: אימייל\n");
    files.set("c.md", "# ג\n\nשלחתי אימייל לכולם.\n");
  });

  it("stages each replacement as a range change and the fact conflict in a report; nothing written before approval", async () => {
    await consistencyFlow(ctxFor(""));
    const staged = listStagedChanges();
    const ranges = staged.filter((c) => c.kind === "range");
    const report = staged.find((c) => c.kind === "file")!;
    expect(ranges.map((c) => [c.path, c.kind === "range" && c.before, c.kind === "range" && c.after]).sort()).toEqual([
      ["b.md", "ירושלם", "ירושלים"],
      ["c.md", "אימייל", "דוא״ל"],
    ]);
    expect(report.path).toMatch(new RegExp(`^${REPORT_DIR}/consistency-\\d{4}-\\d{2}-\\d{2}\\.md$`));
    expect(report.kind === "file" && report.after).toContain("[[a]]");
    expect(report.kind === "file" && report.after).toContain("[[b]]");
    expect(writes).toEqual([]);
    // Accept one: only that one is written.
    const v = ranges.find((c) => c.path === "b.md")!;
    expect((await approveStagedChange(v.id)).status).toBe("applied");
    expect(files.get("b.md")).toContain("בירושלים העתיקה");
    expect(writes).toEqual(["b.md"]);
    expect(toasts.at(-1)).toMatch(/2 suggested edits to review · 1 comments/);
  });

  it("the review panel shows them, axe clean in Hebrew (RTL) and English", async () => {
    await consistencyFlow(ctxFor(""));
    for (const [dir, lang] of [["rtl", "he"], ["ltr", "en"]] as const) {
      const { container, unmount } = render(
        <div dir={dir} lang={lang}>
          <AgentReviewPanel open onClose={() => {}} />
        </div>,
      );
      await waitFor(() => expect(container.textContent).toContain("ירושלם"));
      expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
      unmount();
    }
  });
});

describe("the open note's checks", () => {
  it("structure: comments only, in one staged report, 0 range changes", async () => {
    const note = "# כותרת\n\nפתיחה.\n\n## א\n\nטקסט.\n\n#### ב\n\nטקסט.\n";
    await act(() => structureFlow(ctxFor(note, "s.md")));
    const staged = listStagedChanges();
    expect(staged.filter((c) => c.kind === "range")).toEqual([]);
    const report = staged.find((c) => c.kind === "file")!;
    expect(report.kind === "file" && report.after).toMatch(/דילוג ברמת כותרת|Skipped heading level/);
  });

  it("argument: a fallacy and an unsupported claim, each with its reason, in the report", async () => {
    await argumentFlow(ctxFor("# טיעון\n\nכולם יודעים שהתוכנית תצליח. שישים אחוז מהתלמידים לא קוראים ספרים.\n", "arg.md"));
    const report = listStagedChanges().find((c) => c.kind === "file")!;
    const text = report.kind === "file" ? report.after : "";
    expect(text).toMatch(/פנייה לרוב|Appeal to popularity/);
    expect(text).toMatch(/טענה בלי מקור|Claim without a source/);
    expect(text).toMatch(/\*\*(?:Why|למה):\*\*/);
  });

  it("readability: one line with the level and what raises it (no frequency list reachable: still a level)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await readabilityFlow(ctxFor("המחקר הנוכחי בוחן את השפעתם של מנגנוני ויסות רגשי על תפקודים קוגניטיביים גבוהים בקרב מתבגרים, תוך שימוש במערך ניסויי משולב הכולל מדדים התנהגותיים ופיזיולוגיים."));
    vi.unstubAllGlobals();
    expect(toasts.at(-1)).toMatch(/^Readability: hard · [\d.]+ of 5 \(.+\) — raised most by /);
    expect(listStagedChanges()).toEqual([]);
  });

  it("readabilityLine in English names the Flesch–Kincaid grade", async () => {
    const { readability } = await import("../agents/writing/readability/readability");
    expect(readabilityLine(readability("Notwithstanding the foregoing, the licensee shall remain liable for all obligations incurred prior to termination."))).toMatch(/Flesch–Kincaid grade [\d.]+ .* syllables a word|Flesch–Kincaid grade [\d.]+ .* words each/);
  });

  it("harper: not installed here, so it says so and stages nothing", async () => {
    await harperFlow(ctxFor("We saw a owl near the river bank today.", "h.md"));
    expect(toasts.at(-1)).toMatch(/Harper is not installed/);
    expect(listStagedChanges()).toEqual([]);
  });

  it("an empty note: asks for one", async () => {
    await structureFlow(ctxFor("   "));
    expect(toasts.at(-1)).toMatch(/Open a note/);
  });
});

describe("staging", () => {
  const sug = (i: number, replacement: string | null): WritingSuggestion => ({ range: { from: i, to: i + 1 }, kind: "term-variant", message: `m${i}`, rationale: "because", confidence: 0.9, replacement, agentId: "x", model: "rules", path: "n.md" });
  it(`stages at most ${MAX_STAGED} range changes; the rest go to the report`, () => {
    const text = "x".repeat(400);
    const r = stageWritingSuggestions({ suggestions: Array.from({ length: 160 }, (_, i) => sug(i * 2, "y")), texts: new Map([["n.md", text]]), agentId: "x", tool: "t", labels: reportLabels("consistency"), today: "2026-11-17" });
    expect(r.staged.length).toBe(MAX_STAGED);
    expect(r.report?.kind === "file" && r.report.after.match(/^## /gm)?.length).toBe(10);
  });
  it("links: a block id as a wiki link, a virtual anchor as the note and a quote", () => {
    expect(renderLink("notes/a.md#^abc", new Map())).toBe("[[notes/a#^abc]]");
    const texts = new Map([["a.md", "# A\n\nשורה ראשונה של הפסקה.\n"]]);
    const anchor = "p-" + "x";
    expect(renderLink(`a.md#${anchor}`, texts)).toBe("[[a]]");
  });
});
