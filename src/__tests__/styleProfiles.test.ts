import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null }) } }));
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));
const notes = [
  { path: "j/a.md", text: "---\ntitle: a\n---\nI write short lines. " + "Short and direct sentences only. ".repeat(10) },
  { path: "j/b.md", text: "Another note with plenty of words to count as prose. ".repeat(6) + "\n```js\nconst code = 1;\n```" },
  { path: "other/c.md", text: "tiny" },
];
// The stylist reads the notes through the runtime's list_files + read_file (5.3.3).
vi.mock("../storage/workspace", async (orig) => ({
  ...(await orig<object>()),
  isOPFSAvailable: () => true,
  listWorkspace: async () => notes.map((n) => ({ path: n.path, name: n.path.split("/").pop()!, size: n.text.length, modified: 1 })),
  readWorkspaceFile: async (p: string) => {
    const n = notes.find((x) => x.path === p);
    if (!n) throw new Error("ENOENT");
    return n.text;
  },
}));

import { registerExecutor, resetExecutors } from "../agents/executors";
import { fakeExecutor, sequence } from "./helpers/fakeExecutor";
import { buildStyleProfile, getStyleProfile, styleProfileActive, setStyleProfileActive, styleInstruction, styleModelfile, sampleExcerpts, proseOfNote, clearStyleProfile } from "../ai/styleProfiles";
import { writerAgent } from "../agents/defs";

beforeEach(() => {
  resetExecutors();
  localStorage.clear();
});

describe("style profiles", () => {
  it("samples prose only (no frontmatter, code, tiny notes)", () => {
    expect(proseOfNote("---\nx: 1\n---\nbody\n```\ncode\n```")).toBe("body");
    const s = sampleExcerpts(notes);
    expect(s.count).toBe(2);
    expect(s.text).not.toContain("const code");
    expect(s.text).not.toContain("title: a");
  });

  it("builds a profile, keeps only verbatim examples, and the writer follows it while active", async () => {
    const ex = fakeExecutor(sequence(JSON.stringify({ tone: "Terse", rules: ["Short sentences", "No filler", "Direct verbs"], examples: ["Short and direct sentences only.", "Invented line"] })));
    registerExecutor(ex);
    const p = await buildStyleProfile("j");
    expect(p).toMatchObject({ tone: "Terse", notes: 2, examples: ["Short and direct sentences only."] });
    expect(getStyleProfile()?.rules).toHaveLength(3);
    expect(styleProfileActive()).toBe(true);
    const sys = typeof writerAgent.system === "function" ? writerAgent.system({ text: "x" }) : writerAgent.system;
    expect(sys).toContain("Write in the user's own style.");
    expect(sys).toContain("- Short sentences");
    setStyleProfileActive(false);
    expect(styleInstruction()).toBe("");
    expect(styleModelfile("qwen2.5:7b")).toContain("FROM qwen2.5:7b");
    expect(styleModelfile("qwen2.5:7b")).toContain('SYSTEM """');
    clearStyleProfile();
    expect(getStyleProfile()).toBeNull();
  });

  it("refuses to learn from too little writing", async () => {
    await expect(buildStyleProfile("other")).rejects.toThrow(/Not enough writing/);
  });
});
