/**
 * W10.C12 / plan 5.3.2, the acceptance as a component test: the product
 * builder generates a 5-file product, every file shows up in the agents'
 * review screen (AgentReviewPanel) as a new file with its diff, nothing is
 * written while it waits, and "Approve all" writes exactly those 5 files.
 * The runtime, the staged write_file tool, the review queue and the panel
 * are the real ones; only the model is scripted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../storage/workspace", async (orig) => {
  const m = (await import("./helpers/evalVault")).workspaceModule(await orig()) as { writeWorkspaceFile: (p: string, c: string) => Promise<void> };
  return { ...m, writeWorkspaceFile: vi.fn(m.writeWorkspaceFile) };
});
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));
vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));

import "../agents/defs";
import { registerExecutor, resetExecutors } from "../agents/executors";
import { clearStagedChanges, listStagedChanges } from "../agents/staging";
import { writeWorkspaceFile } from "../storage/workspace";
import { AgentReviewPanel } from "../ui/AgentReviewPanel";
import { fakeExecutor, reply } from "./helpers/fakeExecutor";
import { resetVault, vaultFiles as vault } from "./helpers/evalVault";

const FILES: Record<string, string> = {
  "index.html": "<!doctype html>\n<html><body><div id=app></div><script type=module src=app.js></script></body></html>\n",
  "app.js": "import { start } from './timer.js';\nstart(25);\n",
  "timer.js": "export function start(min) {\n  return min * 60;\n}\n",
  "style.css": "body { margin: 0; }\n",
  "settings.json": '{ "minutes": 25 }\n',
};
const SPEC = { name: "pomodoro", description: "d", features: ["f"], techStack: ["js"], fileStructure: Object.keys(FILES) };

beforeEach(() => {
  resetExecutors();
  clearStagedChanges();
  resetVault();
  vi.mocked(writeWorkspaceFile).mockClear();
  localStorage.setItem("lumen.ai.cache", "off");
});

describe("the builder's 5 files in the review screen (W10.C12)", () => {
  it("5 generated files → 5 pending proposals in AgentReviewPanel, 0 written; Approve all writes exactly those 5", async () => {
    registerExecutor(
      fakeExecutor((req) => {
        const sys = req.messages[0].content;
        if (/product architect/i.test(sys)) return reply(JSON.stringify(SPEC), req.model);
        const path = /File to generate: (\S+)/.exec(req.messages.map((m) => m.content).join("\n"))?.[1];
        // The architecture, test and docs stages: text only, no file of their own.
        return reply(path ? FILES[path] : "generated text", req.model);
      }),
    );
    const { createProduct } = await import("../ai/productAgent");
    const res = await createProduct("a pomodoro timer");
    expect(res.success).toBe(true);
    const source = Object.keys(FILES).map((f) => `pomodoro/${f}`);
    // Every source file is proposed (the builder may add its README / tests on top of the 5).
    const pending = listStagedChanges();
    expect(pending.map((c) => c.path)).toEqual(expect.arrayContaining(source));
    expect(pending.every((c) => c.kind === "file" && c.tool === "write_file" && c.agentId === "builder" && c.before === null)).toBe(true);
    expect([...vault.keys()].filter((p) => p.startsWith("pomodoro/"))).toEqual([]);
    expect(writeWorkspaceFile).not.toHaveBeenCalled();

    render(<AgentReviewPanel open onClose={() => {}} />);
    const panel = screen.getByTestId("agent-review-panel");
    for (const path of source) {
      const c = pending.find((x) => x.path === path)!;
      const card = within(panel).getByTestId(`agent-change-${c.id}`);
      expect(card.getAttribute("data-status"), path).toBe("pending");
      // A new file: every line is an addition.
      const ops = [...within(card).getByTestId("agent-change-lines").querySelectorAll("[data-op]")].map((el) => el.getAttribute("data-op"));
      expect(ops.length, path).toBeGreaterThan(0);
      expect(ops.every((op) => op === "add"), path).toBe(true);
    }
    expect(writeWorkspaceFile).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByTestId("agent-review-approve-all"));
    await waitFor(() => expect(listStagedChanges()).toEqual([]));
    // The generated text, as the model wrote it (the builder trims the final newline): not replaced by a wrapper page.
    for (const f of Object.keys(FILES)) expect(vault.get(`pomodoro/${f}`), f).toBe(FILES[f].trimEnd());
    const written = vi.mocked(writeWorkspaceFile).mock.calls.map(([p]) => p);
    expect(written.sort()).toEqual(pending.map((c) => c.path).sort());
    for (const c of pending) expect(within(panel).getByTestId(`agent-change-${c.id}`).getAttribute("data-status")).toBe("applied");
  });

  it("a product laid out under src/ still gets the root page that opens src/index.html", async () => {
    const spec = { ...SPEC, fileStructure: ["src/index.html", "src/app.js"] };
    const PAGE = "<!doctype html>\n<html><body><p>page</p></body></html>";
    registerExecutor(
      fakeExecutor((req) => {
        if (/product architect/i.test(req.messages[0].content)) return reply(JSON.stringify(spec), req.model);
        const path = /File to generate: (\S+)/.exec(req.messages.map((m) => m.content).join("\n"))?.[1];
        return reply(path === "src/index.html" ? PAGE : path ? "export {};" : "generated text", req.model);
      }),
    );
    const { createProduct } = await import("../ai/productAgent");
    const res = await createProduct("a pomodoro timer");
    expect(res.success).toBe(true);
    expect(res.files.get("pomodoro/src/index.html")).toBe(PAGE);
    expect(res.files.get("pomodoro/index.html")).toContain("./src/index.html");
  });
});
