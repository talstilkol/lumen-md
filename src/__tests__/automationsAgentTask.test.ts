/**
 * W10.E15 (W5.24): the two missing automation actions, "add a task" and
 * "run an agent", in the picker, in the dry run, in a real run and in undo.
 * The agent's change goes to the review queue (agents/staging.ts): the rule
 * itself writes nothing for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Executor, ExecutorResponse } from "../agents/types";

// The runtime's app-wide dependencies, as agentRuntime.test.ts sets them (no store, no local models, quota open).
vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null, dailyNotes: {} }) } }));
vi.mock("../ai/ollamaProvider", () => ({ isOllamaAvailable: async () => false, getBaseUrl: () => "http://localhost:11434", chatOllama: vi.fn(), chatOllamaStream: vi.fn() }));
vi.mock("../ai/localLlm", () => ({ localLlmAvailable: () => ({ available: false }), chatLocal: vi.fn(), chatLocalStream: vi.fn(), onLocalLlmProgress: () => () => {} }));
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, useToastStore: { getState: () => ({ push: vi.fn() }) } }));
vi.mock("../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));
// The vault the automation reads: one note, in memory. Writes are counted: there must be none.
const vault = new Map<string, string>([["Inbox/פגישה.md", "# פגישה\n\nסיכום קצר.\n"]]);
const writes: string[] = [];
vi.mock("../storage/workspace", () => ({
  workspaceHasFile: async (p: string) => vault.has(p),
  readWorkspaceFile: async (p: string) => vault.get(p) ?? "",
  writeWorkspaceFile: async (p: string, t: string) => {
    writes.push(p);
    vault.set(p, t);
  },
  listWorkspace: async () => [...vault.keys()].map((path) => ({ path })),
  deleteWorkspaceFile: vi.fn(),
  renameWorkspaceFile: vi.fn(),
  isOPFSAvailable: () => true,
}));

import { applyPlan, plan, undoRun, TASKS_PATH, type Change, type Fs, type Rule } from "../automations/engine";
import { runAgentForRule } from "../automations/app";
import { ACTIONS } from "../commands/domains/automationsActions";
import { registerAgent } from "../agents/registry";
import { registerExecutor, resetExecutors } from "../agents/executors";
import { listStagedChanges } from "../agents/staging";

const TODAY = "2026-11-15";
const memView = (files: Map<string, string>) => ({ read: (p: string) => files.get(p) ?? null, exists: (p: string) => files.has(p) });
const ctx = (files: Map<string, string>) => ({ vault: memView(files), dailyPath: (d: string) => `Daily/${d}.md`, today: TODAY });
const rule = (id: string, ...then: Rule["then"]): Rule => ({ id, name: id, enabled: true, when: { kind: "created", folder: "Inbox" }, then });
const created = (path: string, text: string) => ({ kind: "created" as const, path, text });

function memFs(files: Map<string, string>, agent?: (c: Extract<Change, { kind: "agent" }>) => Promise<void>): Fs & { n: number } {
  const fs = {
    n: 0,
    read: async (p: string) => files.get(p) ?? null,
    write: async (p: string, t: string) => void (fs.n++, files.set(p, t)),
    move: async (a: string, b: string) => void (fs.n++, files.set(b, files.get(a)!), files.delete(a)),
    remove: async (p: string) => void (fs.n++, files.delete(p)),
    runAgent: agent,
  };
  return fs;
}

describe("the picker (W10.E15)", () => {
  it("offers six actions, with run an agent and add a task", () => {
    expect([...ACTIONS]).toEqual(["move", "tag", "template", "appendDaily", "createTask", "runAgent"]);
  });
});

describe("add a task", () => {
  it("adds `- [ ] …` to Tasks.md (or the note the rule names), once, and triggers nothing", () => {
    const files = new Map([["Inbox/a.md", "a\n"]]);
    const p = plan([rule("r", { kind: "createTask", text: "לעבור על {{link}}" })], created("Inbox/a.md", "a\n"), ctx(files));
    expect(p.changes).toEqual([{ kind: "write", path: TASKS_PATH, before: null, after: "- [ ] לעבור על [[a]]\n", rule: "r" }]);
    expect(p.fired).toHaveLength(1);
    files.set("Lists/todo.md", "# לעשות\n\n- [ ] לעבור על [[a]]\n");
    // The same task again: nothing to add.
    expect(plan([rule("r", { kind: "createTask", text: "לעבור על {{link}}", file: "Lists/todo.md" })], created("Inbox/a.md", "a\n"), ctx(files)).changes).toEqual([]);
    const q = plan([rule("r", { kind: "createTask", text: "{{title}} {{date}}", file: "Lists/todo.md" })], created("Inbox/a.md", "a\n"), ctx(files));
    expect(q.changes).toEqual([{ kind: "write", path: "Lists/todo.md", before: "# לעשות\n\n- [ ] לעבור על [[a]]\n", after: "# לעשות\n\n- [ ] לעבור על [[a]]\n- [ ] a 2026-11-15\n", rule: "r" }]);
  });

  it("a run writes the task and undo takes it back byte for byte", async () => {
    const files = new Map([["Inbox/a.md", "a\n"], [TASKS_PATH, "- [ ] old\n"]]);
    const p = plan([rule("r", { kind: "createTask", text: "{{link}}" })], created("Inbox/a.md", "a\n"), ctx(files));
    const fs = memFs(files);
    const entry = await applyPlan(p, fs, "1", "created Inbox/a.md", new Date(0));
    expect(files.get(TASKS_PATH)).toBe("- [ ] old\n- [ ] [[a]]\n");
    expect(await undoRun(entry, fs)).toEqual({ ok: true });
    expect(files.get(TASKS_PATH)).toBe("- [ ] old\n");
  });
});

describe("run an agent", () => {
  it("is planned, shown in the dry run, started by a run, and has nothing of its own to undo", async () => {
    const files = new Map([["Inbox/a.md", "a\n"]]);
    const r = rule("r", { kind: "runAgent", agent: "summarizer", prompt: "סכם את {{title}}" }, { kind: "tag", tag: "done" });
    const p = plan([r], created("Inbox/a.md", "a\n"), ctx(files));
    expect(p.changes[0]).toEqual({ kind: "agent", agent: "summarizer", path: "Inbox/a.md", prompt: "סכם את a", rule: "r" });
    // The plan (the dry run) writes nothing and runs nothing.
    expect(files.get("Inbox/a.md")).toBe("a\n");
    const started: string[] = [];
    const fs = memFs(files, async (c) => void started.push(`${c.agent} ${c.path}`));
    const entry = await applyPlan(p, fs, "1", "created Inbox/a.md", new Date(0));
    expect(started).toEqual(["summarizer Inbox/a.md"]);
    expect(fs.n).toBe(1); // the tag only
    expect(await undoRun(entry, fs)).toEqual({ ok: true });
    expect(files.get("Inbox/a.md")).toBe("a\n");
  });

  describe("through the runtime and the approval queue", () => {
    beforeEach(() => {
      resetExecutors();
      writes.length = 0;
    });

    it("the agent's answer is staged for review on the note, never written by the rule", async () => {
      // A model stand-in: the runtime, the agent registry and the staging queue are the real ones.
      const executor: Executor = {
        id: "ollama",
        label: "scripted",
        available: async () => ({ available: true }),
        supportsTools: () => false,
        supportsSchema: () => false,
        modelFor: (tier) => `scripted-${tier}`,
        chat: async (): Promise<ExecutorResponse> => ({ content: "סיכום: נקבעה פגישה.", toolCalls: [], model: "scripted-small", usage: { inputTokens: 1, outputTokens: 1, estimated: true } }),
      };
      registerExecutor(executor);
      registerAgent({ id: "e15-summarizer", description: "test", system: "sys", user: (i) => i.text ?? "" });
      const before = listStagedChanges().length;
      const { staged } = await runAgentForRule({ kind: "agent", agent: "e15-summarizer", path: "Inbox/פגישה.md", prompt: "", rule: "r1" });
      expect(staged).toHaveLength(1);
      const pending = listStagedChanges();
      expect(pending.length).toBe(before + 1);
      const change = pending.find((c) => c.id === staged[0])!;
      expect(change).toMatchObject({ kind: "file", path: "Inbox/פגישה.md", status: "pending", tool: "automation", agentId: "e15-summarizer" });
      expect((change as { after: string }).after).toBe("# פגישה\n\nסיכום קצר.\n\nסיכום: נקבעה פגישה.\n");
      expect(writes).toEqual([]);
      expect(vault.get("Inbox/פגישה.md")).toBe("# פגישה\n\nסיכום קצר.\n");
    });

    it("Esc (Cancel AI) aborts a rule's agent: the model sees the signal and nothing is staged (1.4)", async () => {
      const { cancelAllAi, aiBusy } = await import("../ai/aiAbort");
      let seen: AbortSignal | undefined;
      const executor: Executor = {
        id: "ollama",
        label: "scripted",
        available: async () => ({ available: true }),
        supportsTools: () => false,
        supportsSchema: () => false,
        modelFor: (tier) => `scripted-${tier}`,
        chat: (req) =>
          new Promise<ExecutorResponse>((_, reject) => {
            seen = req.signal;
            req.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      };
      registerExecutor(executor);
      registerAgent({ id: "e15-slow", description: "test", system: "sys", user: (i) => i.text ?? "" });
      const before = listStagedChanges().length;
      const pending = runAgentForRule({ kind: "agent", agent: "e15-slow", path: "Inbox/פגישה.md", prompt: "", rule: "r1" });
      await vi.waitFor(() => expect(seen).toBeDefined());
      expect(aiBusy()).toBe(true);
      expect(cancelAllAi()).toBe(1);
      const { staged } = await pending;
      expect(seen!.aborted).toBe(true);
      expect(staged).toEqual([]);
      expect(listStagedChanges().length).toBe(before);
      expect(aiBusy()).toBe(false);
      expect(writes).toEqual([]);
    });

    it("an unknown agent is an error, not a silent skip", async () => {
      await expect(runAgentForRule({ kind: "agent", agent: "no-such-agent", path: null, prompt: "", rule: "r" })).rejects.toThrow(/no-such-agent/);
    });
  });
});
