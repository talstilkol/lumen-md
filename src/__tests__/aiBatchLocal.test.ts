import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null }) } }));
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import * as batch from "../ai/batch";

describe("local batch queue", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is the batch provider under local policies; the cloud Batch API only under cloud", () => {
    expect(batch.batchProviderFor("ollama")).toBe("local");
    expect(batch.batchProviderFor("anthropic")).toBe("local");
    localStorage.setItem("lumen.ai.policy", "cloud");
    expect(batch.batchProviderFor("anthropic")).toBe("anthropic");
    expect(batch.batchProviderFor("gemini")).toBeNull();
  });

  it("answers each note with the batch prompts, records failures, and reports processing until done", async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    batch.__setLocalBatchDeps({
      answer: async (_system, user) => {
        seen.push(user);
        await gate;
        if (user.includes("boom")) throw new Error("model failed");
        return `summary of ${user.slice(0, 5)}`;
      },
      read: async () => null,
    });
    const job = await batch.submitBatch("summary", [
      { path: "a.md", text: "alpha text" },
      { path: "b.md", text: "boom text" },
    ]);
    expect(batch.loadJobs().some((j) => j.id === job.id)).toBe(true);
    expect((await batch.fetchBatchResults(job)).state).toBe("processing");
    release();
    await batch.__localBatchRun(job.id);
    const res = await batch.fetchBatchResults(job);
    expect(res.state).toBe("ended");
    expect(res.failed).toBe(1);
    expect(res.answers.get("n0")).toBe("summary of alpha");
    expect(seen).toHaveLength(2);
  });

  it("resumes an interrupted job from the workspace, only for missing notes", async () => {
    const answered: string[] = [];
    batch.__setLocalBatchDeps({
      answer: async (_s, user) => {
        answered.push(user);
        return "ok";
      },
      read: async (path) => (path === "c.md" ? "gamma text" : null),
    });
    const job: batch.BatchJob = { id: "local_resume", provider: "local", model: "m", op: "tags", createdAt: "", items: [{ customId: "n0", path: "c.md", hash: batch.textHash("gamma text") }], status: "submitted" };
    batch.saveJobs([job]);
    expect((await batch.fetchBatchResults(job)).state).toBe("processing");
    await batch.__localBatchRun(job.id);
    expect((await batch.fetchBatchResults(job)).answers.get("n0")).toBe("ok");
    expect(answered).toEqual(["gamma text"]);
    await batch.clearLocalBatch(job.id);
  });
});
