/**
 * Blind tests (plan W6.15, W10.D19): the privacy ledger and airplane mode
 * inside Web Workers.
 *
 * Written from the spec only: the "Workers (model downloads)" row of
 * docs/src/content/docs/ai/airplane-mode.md and the declarations tsc emits for
 * src/ai/workerLedger.ts (signatures, message types and doc comments, no
 * function bodies, no existing workerLedger tests). Lane X-BL, against
 * verify/train-5 (c3f055218e).
 *
 * Properties: every worker request is reported (start, then end with its
 * status); the worker asks its own window whether airplane mode is on and,
 * while it is, refuses requests to another host itself; with no answer
 * within AIRPLANE_WAIT_MS it refuses too (fail closed); another tab can't
 * answer for it; once it has heard "on" it stays on until reload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIRPLANE_CHANNEL,
  AIRPLANE_TAB_MARK,
  AIRPLANE_WAIT_MS,
  installWorkerLedger,
  LEDGER_CHANNEL,
  reportWorkerDownload,
  __resetWorkerLedger,
  type AirplaneMessage,
  type WorkerLedgerMessage,
} from "../../ai/workerLedger";

const ORIGIN = "https://app.example.test";

function harness(name = "transformers") {
  const ledger: WorkerLedgerMessage[] = [];
  const air: AirplaneMessage[] = [];
  const listeners: Array<(e: MessageEvent) => void> = [];
  const calls: string[] = [];
  const realFetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response("model-bytes", { status: 200 });
  });
  const scope = { fetch: realFetch as unknown as typeof fetch, name, location: { pathname: "/assets/worker.js", href: `${ORIGIN}/assets/worker.js` } };
  const channel = { postMessage: (m: unknown) => ledger.push(m as WorkerLedgerMessage) };
  const airChannel = {
    postMessage: (m: unknown) => air.push(m as AirplaneMessage),
    addEventListener: (_t: string, fn: unknown) => listeners.push(fn as (e: MessageEvent) => void),
  };
  const ok = installWorkerLedger(scope, channel, airChannel as unknown as Pick<BroadcastChannel, "postMessage" | "addEventListener">);
  const say = (m: AirplaneMessage) => listeners.forEach((fn) => fn(new MessageEvent("message", { data: m })));
  return { ok, scope, ledger, air, say, calls, realFetch };
}

const outcome = (p: Promise<Response>) =>
  p.then(
    (r) => `ok ${r.status}`,
    () => "refused",
  );

beforeEach(() => __resetWorkerLedger());

describe("blind: worker ledger (W10.D19)", () => {
  it("W1 the channels are the documented ones, and a second install is refused", () => {
    expect(LEDGER_CHANNEL).toBe("lumen-privacy-ledger");
    expect(AIRPLANE_CHANNEL).toBe("lumen-airplane");
    expect(AIRPLANE_WAIT_MS).toBe(3000);
    const h = harness();
    expect(h.ok).toBe(true);
    const again = installWorkerLedger(h.scope, { postMessage: () => undefined }, { postMessage: () => undefined, addEventListener: () => undefined } as unknown as Pick<BroadcastChannel, "postMessage" | "addEventListener">);
    expect(again).toBe(false);
  });

  it("W2 every request is reported: a start with its url and method, then an end with the same id and the status", async () => {
    const h = harness();
    h.say({ kind: "state", on: false });
    const r = await h.scope.fetch("https://huggingface.co/models/whisper/model.onnx", { method: "GET" });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 10));
    const start = h.ledger.find((m) => m.kind === "start") as Extract<WorkerLedgerMessage, { kind: "start" }>;
    expect(start).toBeTruthy();
    expect(start.url).toContain("huggingface.co/models/whisper/model.onnx");
    expect(start.method).toBe("GET");
    const end = h.ledger.find((m) => m.kind === "end" && m.id === start.id) as Extract<WorkerLedgerMessage, { kind: "end" }>;
    expect(end).toBeTruthy();
    expect(end.status).toBe(200);
  });

  it("W3 the worker asks its window first ('hello'), naming its window's id from its name", () => {
    const h = harness(`whisper${AIRPLANE_TAB_MARK}tab-123`);
    const hello = h.air.find((m) => m.kind === "hello") as Extract<AirplaneMessage, { kind: "hello" }>;
    expect(hello).toBeTruthy();
    expect(hello.tab).toBe("tab-123");
  });
});

describe("blind: airplane mode in workers (W10.D19)", () => {
  it("W4 while it is on, a request to another host is refused in the worker, before it leaves, and reported as blocked", async () => {
    const h = harness();
    h.say({ kind: "state", on: true });
    expect(await outcome(h.scope.fetch("https://huggingface.co/model.onnx"))).toBe("refused");
    expect(h.calls).toHaveLength(0);
    const att = h.air.find((m) => m.kind === "attempt") as Extract<AirplaneMessage, { kind: "attempt" }>;
    expect(att).toBeTruthy();
    expect(att.blocked).toBe(true);
  });

  it("W5 a worker that hears nothing within AIRPLANE_WAIT_MS refuses requests to another host (fail closed)", async () => {
    const h = harness();
    const t0 = Date.now();
    const r = await outcome(h.scope.fetch("https://huggingface.co/model.onnx"));
    expect(r).toBe("refused");
    expect(h.calls).toHaveLength(0);
    expect(Date.now() - t0).toBeLessThan(AIRPLANE_WAIT_MS + 2000);
  }, 15_000);

  it("W6 an answer that says off lets it through", async () => {
    const h = harness();
    h.say({ kind: "state", on: false });
    expect(await outcome(h.scope.fetch("https://huggingface.co/model.onnx"))).toBe("ok 200");
    expect(h.calls).toHaveLength(1);
  });

  it("W7 'on' sticks: once the worker heard on, a later 'off' doesn't release it (only a reload does)", async () => {
    const h = harness();
    h.say({ kind: "state", on: true });
    h.say({ kind: "state", on: false });
    expect(await outcome(h.scope.fetch("https://huggingface.co/model.onnx"))).toBe("refused");
    expect(h.calls).toHaveLength(0);
  });

  it("W8 another tab can't answer for it: a state for another window's id is ignored", async () => {
    const h = harness(`whisper${AIRPLANE_TAB_MARK}mine`);
    h.say({ kind: "state", on: false, tab: "someone-else" });
    // No answer for this window: after the wait it refuses.
    expect(await outcome(h.scope.fetch("https://huggingface.co/model.onnx"))).toBe("refused");
    expect(h.calls).toHaveLength(0);
  }, 15_000);

  it("W9 its own window's 'off' is taken", async () => {
    const h = harness(`whisper${AIRPLANE_TAB_MARK}mine`);
    h.say({ kind: "state", on: false, tab: "mine" });
    expect(await outcome(h.scope.fetch("https://huggingface.co/model.onnx"))).toBe("ok 200");
  });

  it("W10 another tab's 'on' can't be undone by another tab's 'off' either: an 'on' for this window sticks", async () => {
    const h = harness(`whisper${AIRPLANE_TAB_MARK}mine`);
    h.say({ kind: "state", on: true, tab: "mine" });
    h.say({ kind: "state", on: false, tab: "mine" });
    h.say({ kind: "state", on: false, tab: "other" });
    expect(await outcome(h.scope.fetch("https://huggingface.co/model.onnx"))).toBe("refused");
  });
});

describe("blind: downloads fetch can't see (W10.D19)", () => {
  it("W11 reportWorkerDownload is null without the ledger; with it, the outcome settles the record (a failure is never a success)", async () => {
    expect(reportWorkerDownload("https://huggingface.co/x.wasm")).toBeNull();
    const h = harness();
    const ok = reportWorkerDownload("https://huggingface.co/mlc/model-a.bin");
    expect(ok).toBeTypeOf("function");
    ok!(200);
    const fail = reportWorkerDownload("https://huggingface.co/mlc/model-b.bin");
    fail!(0);
    await new Promise((res) => setTimeout(res, 10));
    const starts = h.ledger.filter((m) => m.kind === "start") as Array<Extract<WorkerLedgerMessage, { kind: "start" }>>;
    const a = starts.find((s) => s.url.includes("model-a"))!;
    const b = starts.find((s) => s.url.includes("model-b"))!;
    const endOf = (id: string) => h.ledger.find((m) => m.kind === "end" && m.id === id) as Extract<WorkerLedgerMessage, { kind: "end" }>;
    expect(endOf(a.id).status).toBe(200);
    expect(endOf(b.id).status).toBe(0);
    expect(endOf(a.id).bytesIn).toBeNull();
  });
});
