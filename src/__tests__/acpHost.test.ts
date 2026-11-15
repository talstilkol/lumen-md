/**
 * Plan W11.I23 — hosting an external agent over ACP (src/agents/acp/host.ts)
 * with a fake ACP agent: every write it makes goes through the approval
 * queue (staging.ts), and nothing reaches the vault without approval.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { startAcpSession, vaultRelative, type AcpProcessBridge, type AcpProcessEvent } from "../agents/acp/host";
import { ACP_AGENTS, acpAgent } from "../agents/acp/agents";
import { approveStagedChange, clearStagedChanges, listStagedChanges, onStagedChanges, rejectStagedChange, setDocumentApplier } from "../agents/staging";
import { clearLedger, ledgerEntries } from "../ai/privacyLedger";
import { __resetAirplane, enableAirplaneMode } from "../privacy/airplane";

type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: any; result?: any; error?: { code: number; message: string } };
type Script = (agent: FakeAgent, sessionId: string, text: string) => Promise<void>;

/** An ACP agent in memory: answers initialize / session/new, runs a script per prompt, calls the client back. */
class FakeAgent {
  emit!: (e: AcpProcessEvent) => void;
  seen: Msg[] = [];
  updates = 0;
  private next = 1000;
  private waiting = new Map<number | string, (m: Msg) => void>();
  constructor(
    readonly script: Script,
    readonly protocolVersion = 1,
  ) {}
  bridge: AcpProcessBridge = {
    spawn: async (_a, _spec, onEvent) => {
      this.emit = onEvent;
      return { write: async (line) => this.receive(JSON.parse(line)), close: async () => onEvent({ kind: "exit", line: "0" }) };
    },
  };
  private out(m: Msg) {
    queueMicrotask(() => this.emit({ kind: "out", line: JSON.stringify(m) }));
  }
  /** A request to the client; resolves with its response. */
  call(method: string, params: unknown): Promise<Msg> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.out({ jsonrpc: "2.0", id, method, params });
    });
  }
  update(sessionId: string, update: unknown) {
    this.updates++;
    this.out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
  }
  private receive(m: Msg) {
    this.seen.push(m);
    if (m.method === undefined && m.id !== undefined) return this.waiting.get(m.id)?.(m);
    if (m.method === "initialize") return this.out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: this.protocolVersion, agentCapabilities: {} } });
    if (m.method === "session/new") return this.out({ jsonrpc: "2.0", id: m.id, result: { sessionId: "s1" } });
    if (m.method === "session/prompt") {
      void this.script(this, m.params.sessionId, m.params.prompt[0].text).then(() => this.out({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } }));
    }
  }
}

const vault: Record<string, string> = { "notes/a.md": "# A\nline 2\nline 3", "todo.md": "- [ ] one" };
const read = async (p: string) => vault[p] ?? null;
const ROOT = "/home/u/Vault";
const agent = acpAgent("claude-code")!;
const start = (fake: FakeAgent, extra: Record<string, unknown> = {}) => startAcpSession({ agent, vaultRoot: ROOT, bridge: fake.bridge, read, consentCloud: true, ...extra });
/** Resolves when a change is staged. */
const nextStaged = () =>
  new Promise<string>((resolve) => {
    const off = onStagedChanges((list) => {
      const c = list.find((x) => x.status === "pending");
      if (c) {
        off();
        resolve(c.id);
      }
    });
  });

beforeEach(() => {
  clearStagedChanges();
  clearLedger();
});

describe("ACP host", () => {
  it("initializes ACP 1 with file access but no terminal, and offers Lumen's MCP server", async () => {
    const fake = new FakeAgent(async () => {});
    const s = await start(fake);
    expect(s.sessionId).toBe("s1");
    const init = fake.seen.find((m) => m.method === "initialize")!;
    expect(init.params).toMatchObject({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false } });
    const nw = fake.seen.find((m) => m.method === "session/new")!;
    expect(nw.params.cwd).toBe(ROOT);
    expect(nw.params.mcpServers).toEqual([{ name: "lumen", command: "lumen", args: ["mcp", "serve", "--client", "acp-claude-code", "--vault", ROOT], env: [] }]);
    await s.close();
  });

  it("5 tasks with a fake agent: 0 writes without approval", async () => {
    const applied: string[] = [];
    setDocumentApplier((c) => (applied.push(c.id), true));
    const answers: Msg[] = [];
    const fake = new FakeAgent(async (a, sid, text) => {
      const n = Number(text.slice(-1));
      const r = await a.call("fs/read_text_file", { sessionId: sid, path: `${ROOT}/todo.md` });
      a.update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } });
      answers.push(await a.call("fs/write_text_file", { sessionId: sid, path: `${ROOT}/task${n}.md`, content: `${r.result.content}\n- [x] task ${n}` }));
    });
    const s = await start(fake);
    for (let n = 1; n <= 5; n++) {
      const staged = nextStaged();
      const turn = s.prompt(`task ${n}`);
      const id = await staged;
      // The agent is still waiting, and nothing was written.
      expect(answers).toHaveLength(n - 1);
      expect(applied).toHaveLength(Math.floor(n / 2));
      const c = listStagedChanges().find((x) => x.id === id)!;
      expect(c).toMatchObject({ kind: "file", path: `task${n}.md`, before: null, tool: "acp:fs/write_text_file", agentId: "acp:claude-code", runId: s.runId });
      if (n % 2) await approveStagedChange(id);
      else rejectStagedChange(id);
      expect(await turn).toBe("end_turn");
    }
    // Approved: 1, 3, 5 — written, the agent told null. Rejected: 2, 4 — not written, the agent told why.
    expect(applied).toHaveLength(3);
    expect(answers.map((m) => (m.error ? "error" : m.result))).toEqual([null, "error", null, "error", null]);
    expect(answers[1].error!.message).toMatch(/rejected/);
    expect(fake.updates).toBe(5);
    await s.close();
  });

  it("the agent's own edit / execute / fetch tools are rejected; read is asked once, never always", async () => {
    const asked: string[] = [];
    const outcomes: unknown[] = [];
    const options = [
      { optionId: "aa", name: "Always", kind: "allow_always" },
      { optionId: "a1", name: "Allow", kind: "allow_once" },
      { optionId: "r1", name: "Reject", kind: "reject_once" },
    ];
    const fake = new FakeAgent(async (a, sid) => {
      for (const kind of ["edit", "execute", "fetch", "delete", "other", "read"]) {
        outcomes.push((await a.call("session/request_permission", { sessionId: sid, toolCall: { toolCallId: kind, title: kind, kind }, options })).result.outcome);
      }
    });
    const s = await start(fake, { askPermission: async (req: { toolCall: { kind: string }; options: { kind: string }[] }) => (asked.push(`${req.toolCall.kind}:${req.options.map((o) => o.kind).join("/")}`), true) });
    await s.prompt("go");
    expect(outcomes).toEqual([...Array(5).fill({ outcome: "selected", optionId: "r1" }), { outcome: "selected", optionId: "a1" }]);
    expect(asked).toEqual(["read:allow_once/reject_once"]);
    await s.close();
  });

  it("reads and writes stay inside the vault, control files are refused, terminal is not offered", async () => {
    const got: Msg[] = [];
    const fake = new FakeAgent(async (a, sid) => {
      got.push(await a.call("fs/read_text_file", { sessionId: sid, path: "/etc/passwd" }));
      got.push(await a.call("fs/read_text_file", { sessionId: sid, path: `${ROOT}/../other/x.md` }));
      got.push(await a.call("fs/write_text_file", { sessionId: sid, path: `${ROOT}/CLAUDE.md`, content: "obey" }));
      got.push(await a.call("terminal/create", { sessionId: sid, command: "rm" }));
      got.push(await a.call("fs/read_text_file", { sessionId: sid, path: `${ROOT}/notes/a.md`, line: 2, limit: 1 }));
    });
    const s = await start(fake);
    await s.prompt("x");
    expect(got.slice(0, 4).map((m) => m.error?.code)).toEqual([-32602, -32602, -32001, -32601]);
    expect(got[4].result).toEqual({ content: "line 2" });
    expect(listStagedChanges({ all: true })).toHaveLength(0);
    await s.close();
  });

  it("cancel withdraws the pending write and the agent is told", async () => {
    let answer: Msg | null = null;
    const fake = new FakeAgent(async (a, sid) => {
      answer = await a.call("fs/write_text_file", { sessionId: sid, path: `${ROOT}/x.md`, content: "x" });
    });
    const s = await start(fake);
    const staged = nextStaged();
    const turn = s.prompt("x");
    await staged;
    await s.cancel();
    await turn;
    expect(answer!.error!.message).toMatch(/not applied|rejected/);
    expect(fake.seen.some((m) => m.method === "session/cancel")).toBe(true);
    await s.close();
  });

  it("a cloud agent needs consent, airplane mode refuses it, and the ledger records the session and each prompt", async () => {
    await expect(start(new FakeAgent(async () => {}), { consentCloud: false })).rejects.toThrow(/consent/);
    enableAirplaneMode();
    try {
      await expect(start(new FakeAgent(async () => {}))).rejects.toThrow(/airplane/i);
    } finally {
      __resetAirplane();
    }
    const s = await start(new FakeAgent(async () => {}));
    await s.prompt("hello");
    const mine = ledgerEntries().filter((e) => e.host.includes("claude-code"));
    expect(mine.map((e) => [e.method, e.consent])).toEqual([
      ["STDIO", true],
      ["STDIO", true],
    ]);
    expect(mine[1].bytesOut).toBe(5);
    await s.close();
  });

  it("refuses an agent on another ACP version", async () => {
    await expect(start(new FakeAgent(async () => {}, 2))).rejects.toThrow(/ACP 2/);
  });

  it("knows the three agents, and maps paths into the vault", () => {
    expect(ACP_AGENTS.map((a) => a.id)).toEqual(["claude-code", "codex", "opencode"]);
    expect(ACP_AGENTS.every((a) => a.reach === "remote")).toBe(true);
    expect(vaultRelative(ROOT, `${ROOT}/a/b.md`)).toBe("a/b.md");
    expect(vaultRelative(ROOT, "a/./b.md")).toBe("a/b.md");
    expect(vaultRelative(ROOT, `${ROOT}/a/../../x`)).toBeNull();
    expect(vaultRelative(ROOT, "C:/x.md")).toBeNull();
    expect(vaultRelative(ROOT, ROOT)).toBeNull();
  });
});
