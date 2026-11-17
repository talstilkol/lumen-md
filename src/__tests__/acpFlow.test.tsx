/**
 * W11.I23 through the command the user runs ("Ask an external agent…",
 * commands/domains/acpActions.ts), with a fake ACP agent behind the process
 * bridge: the live panel shows what the agent says and runs, the first file
 * it writes opens the review panel and waits there (0 writes without
 * approval), a rejection reaches the agent, Stop withdraws a pending write
 * and tells the agent, and focus is never left on <body>.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { askExternalAgentFlow, type AcpFlowDeps } from "../commands/domains/acpActions";
import { openAcpPanel } from "../agents/acp/AcpSessionPanel";
import type { AcpProcessBridge, AcpProcessEvent } from "../agents/acp/host";
import { approveStagedChange, clearStagedChanges, listStagedChanges, onStagedChanges, rejectStagedChange, setDocumentApplier } from "../agents/staging";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: any; result?: any; error?: { code: number; message: string } };
const tick = () => new Promise((r) => setTimeout(r, 0));
const ROOT = "/home/u/Vault";

class FakeAgent {
  emit!: (e: AcpProcessEvent) => void;
  seen: Msg[] = [];
  private next = 1000;
  private waiting = new Map<number | string, (m: Msg) => void>();
  constructor(readonly script: (a: FakeAgent, sid: string) => Promise<string>) {}
  bridge: AcpProcessBridge = {
    spawn: async (_a, _spec, onEvent) => {
      this.emit = onEvent;
      return { write: async (line) => this.receive(JSON.parse(line)), close: async () => onEvent({ kind: "exit", line: "0" }) };
    },
  };
  out(m: Msg) {
    queueMicrotask(() => this.emit({ kind: "out", line: JSON.stringify(m) }));
  }
  call(method: string, params: unknown): Promise<Msg> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.out({ jsonrpc: "2.0", id, method, params });
    });
  }
  update(sid: string, update: unknown) {
    this.out({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update } });
  }
  private receive(m: Msg) {
    this.seen.push(m);
    if (m.method === undefined && m.id !== undefined) return this.waiting.get(m.id)?.(m);
    if (m.method === "initialize") return this.out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: 1 } });
    if (m.method === "session/new") return this.out({ jsonrpc: "2.0", id: m.id, result: { sessionId: "s1" } });
    if (m.method === "session/prompt") void this.script(this, m.params.sessionId).then((stopReason) => this.out({ jsonrpc: "2.0", id: m.id, result: { stopReason } }));
  }
}

function deps(fake: FakeAgent, text = "סכם את todo.md"): AcpFlowDeps {
  return {
    bridge: () => fake.bridge,
    vaultRoot: async () => ROOT,
    read: async (p) => (p === "todo.md" ? "- [ ] one" : null),
    ui: { select: async () => "claude-code", confirm: async () => true, prompt: async () => text },
    openPanel: openAcpPanel,
  };
}
const nextStaged = () =>
  new Promise<string>((resolve) => {
    const off = onStagedChanges((list) => {
      const c = list.find((x) => x.status === "pending");
      if (c) (off(), resolve(c.id));
    });
  });
const panel = () => document.querySelector<HTMLElement>("[data-testid=acp-panel]");

beforeEach(() => {
  clearStagedChanges();
  document.querySelectorAll("[data-testid=acp-panel]").forEach((p) => p.parentElement?.remove());
});

describe("W11.I23: the 'Ask an external agent' command with its live panel", () => {
  it("shows the agent's words and tools; its write waits for approval (0 without), a rejection reaches the agent", async () => {
    const applied: string[] = [];
    setDocumentApplier((c) => (applied.push(c.id), true));
    let reviewOpened = 0;
    const onReview = () => reviewOpened++;
    window.addEventListener("lumen-open-agent-review", onReview);
    const answers: Msg[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fake = new FakeAgent(async (a, sid) => {
      a.update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "קורא את " } });
      a.update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "todo.md" } });
      a.update(sid, { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read todo.md", kind: "read", status: "in_progress" });
      const r = await a.call("fs/read_text_file", { sessionId: sid, path: `${ROOT}/todo.md` });
      a.update(sid, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
      answers.push(await a.call("fs/write_text_file", { sessionId: sid, path: `${ROOT}/summary.md`, content: `# Summary\n${r.result.content}` }));
      await gate;
      answers.push(await a.call("fs/write_text_file", { sessionId: sid, path: `${ROOT}/second.md`, content: "x" }));
      return "end_turn";
    });
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const staged = nextStaged();
    let run!: Promise<void>;
    await act(async () => {
      run = askExternalAgentFlow(deps(fake));
      await tick();
    });
    const first = await staged;
    await act(async () => {
      for (let i = 0; i < 5; i++) await tick();
    });
    // The panel: the agent's text (one paragraph), its tool with its status, focus on Stop.
    expect(panel()!.dataset.state).toBe("running");
    const log = panel()!.querySelector<HTMLElement>("[data-testid=acp-panel-log]")!;
    expect(log.getAttribute("role")).toBe("log");
    expect(log.tabIndex).toBe(0);
    expect(log.textContent).toContain("קורא את todo.md");
    expect(log.querySelector("p[dir=auto]")!.textContent).toBe("קורא את todo.md");
    expect(panel()!.querySelector("[data-testid=acp-tool]")!.textContent).toMatch(/Read todo\.md.*done/);
    expect(document.activeElement).toBe(panel()!.querySelector("[data-testid=acp-stop]"));
    // The write waits: nothing applied, the agent has no answer, the review panel was opened once.
    expect(listStagedChanges().find((c) => c.id === first)).toMatchObject({ path: "summary.md", status: "pending", agentId: "acp:claude-code" });
    expect(applied).toEqual([]);
    expect(answers).toEqual([]);
    expect(reviewOpened).toBe(1);
    // Reject the first: the agent is told; nothing written.
    await act(async () => {
      rejectStagedChange(first);
      await tick();
      await tick();
    });
    expect(answers[0].error!.message).toMatch(/rejected/);
    expect(applied).toEqual([]);
    // Approve the second: written once, the agent gets null.
    const staged2 = nextStaged();
    release();
    const second = await staged2;
    expect(applied).toEqual([]);
    await act(async () => {
      await approveStagedChange(second);
      await run;
    });
    expect(applied).toEqual([second]);
    expect(answers[1].result).toBeNull();
    // Finished: the status says so, Close replaces Stop and has focus; Close gives focus back.
    expect(panel()!.dataset.state).toBe("done");
    expect(panel()!.querySelector("[data-testid=acp-panel-status]")!.textContent).toContain("end_turn");
    const close = panel()!.querySelector<HTMLButtonElement>("[data-testid=acp-close]")!;
    expect(document.activeElement).toBe(close);
    await act(async () => close.click());
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener);
    window.removeEventListener("lumen-open-agent-review", onReview);
    opener.remove();
  });

  it("Stop withdraws the pending write, tells the agent (session/cancel), and nothing is written", async () => {
    const applied: string[] = [];
    setDocumentApplier((c) => (applied.push(c.id), true));
    let answer: Msg | null = null;
    const fake = new FakeAgent(async (a, sid) => {
      answer = await a.call("fs/write_text_file", { sessionId: sid, path: `${ROOT}/x.md`, content: "x" });
      return "cancelled";
    });
    const staged = nextStaged();
    let run!: Promise<void>;
    await act(async () => {
      run = askExternalAgentFlow(deps(fake));
      await tick();
    });
    const id = await staged;
    await act(async () => {
      panel()!.querySelector<HTMLButtonElement>("[data-testid=acp-stop]")!.click();
      await run;
    });
    expect(fake.seen.some((m) => m.method === "session/cancel")).toBe(true);
    expect(listStagedChanges({ all: true }).find((c) => c.id === id)?.status).not.toBe("pending");
    expect(answer!.error).toBeTruthy();
    expect(applied).toEqual([]);
    expect(panel()!.dataset.state).toBe("done");
    expect(document.activeElement).toBe(panel()!.querySelector("[data-testid=acp-close]"));
    await act(async () => panel()!.querySelector<HTMLButtonElement>("[data-testid=acp-close]")!.click());
  });

  it("an agent that cannot start: the panel says why and focus lands on Close, not <body>", async () => {
    const d = deps(new FakeAgent(async () => "end_turn"));
    const refusal = Object.assign(new Error('not approved: you did not allow "claude-code-acp" to run'), { name: "McpClientError" });
    d.bridge = () => ({ spawn: async () => Promise.reject(refusal) });
    await act(async () => {
      await askExternalAgentFlow(d);
    });
    expect(panel()!.dataset.state).toBe("failed");
    expect(panel()!.querySelector("[data-testid=acp-panel-status]")!.textContent).toMatch(/not approved/);
    expect(document.activeElement).toBe(panel()!.querySelector("[data-testid=acp-close]"));
    await act(async () => panel()!.querySelector<HTMLButtonElement>("[data-testid=acp-close]")!.click());
  });
});
