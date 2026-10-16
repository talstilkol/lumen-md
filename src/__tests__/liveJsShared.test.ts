/**
 * LiveJS "REPL across blocks" (```live-js shared```).
 *
 * jsdom has no Web Workers, so the real WORKER_SOURCE is evaluated inside a
 * Node `vm` context whose global object plays the worker's `self`. That gives
 * an end-to-end check of the actual protocol (run → log* → done) and of
 * global-scope persistence, without launching a browser.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import vm from "node:vm";
import { WORKER_SOURCE } from "../plugins/LiveJsBlock";
import { hoistTopLevelBindings, tokenize } from "../plugins/liveJsScope";
import {
  SharedScopeRegistry,
  sharedScopeName,
  SHARED_SCOPE_IDLE_MS,
} from "../plugins/liveJsShared";
import type { WorkerLike, WorkerMessage, WorkerRunPayload, LogLevel } from "../plugins/liveJsShared";

/* ─── A worker emulated in a vm context ───────────────────────────────── */

class VmWorker implements WorkerLike {
  private messageFns: Array<(e: MessageEvent) => void> = [];
  private ctx: vm.Context;
  terminated = false;
  closed = false;

  constructor() {
    const listeners: Array<(e: { data: unknown }) => void> = [];
    const sandbox: Record<string, unknown> = {
      setTimeout,
      clearTimeout,
      postMessage: (data: unknown) => {
        if (this.terminated || this.closed) return;
        // Async, like a real worker → host message.
        queueMicrotask(() => {
          if (this.terminated) return;
          for (const fn of this.messageFns) fn({ data } as MessageEvent);
        });
      },
      addEventListener: (type: string, fn: (e: { data: unknown }) => void) => {
        if (type === "message") listeners.push(fn);
      },
      close: () => {
        this.closed = true;
      },
    };
    sandbox.self = sandbox;
    sandbox.__dispatch = (data: unknown) => {
      for (const fn of listeners) fn({ data });
    };
    this.ctx = vm.createContext(sandbox);
    vm.runInContext(WORKER_SOURCE, this.ctx);
  }

  postMessage(msg: WorkerRunPayload) {
    if (this.terminated || this.closed) return;
    (this.ctx.__dispatch as (d: unknown) => void)(msg);
  }

  addEventListener(type: "message" | "error", fn: ((e: MessageEvent) => void) | ((e: ErrorEvent) => void)) {
    if (type === "message") this.messageFns.push(fn as (e: MessageEvent) => void);
  }

  terminate() {
    this.terminated = true;
  }

  /** Read a global of the worker realm. */
  global(name: string): unknown {
    return (this.ctx as Record<string, unknown>)[name];
  }
}

/** Run `source` directly against a worker; resolve with logs + done message. */
function runRaw(w: VmWorker, source: string, runId = 1, timeoutMs = 2000) {
  return new Promise<{ logs: Array<[LogLevel, string]>; done: WorkerMessage }>((resolve) => {
    const logs: Array<[LogLevel, string]> = [];
    w.addEventListener("message", (e: MessageEvent) => {
      const m = e.data as WorkerMessage;
      if (m.runId !== runId) return;
      if (m.type === "log") logs.push([m.level!, m.parts!.join(" ")]);
      else resolve({ logs, done: m });
    });
    w.postMessage({ type: "run", runId, source, timeoutMs });
  });
}

/** Run through the registry; resolve with logs + end reason. */
function runShared(reg: SharedScopeRegistry, key: string, source: string, timeoutMs = 2000) {
  return new Promise<{ logs: string[]; errors: string[]; reason: string }>((resolve) => {
    const logs: string[] = [];
    const errors: string[] = [];
    const h = reg.run(key, hoistTopLevelBindings(source), timeoutMs, {
      onLog: (level, parts) => (level === "error" ? errors : logs).push(parts.join(" ")),
      onEnd: (reason) => resolve({ logs, errors, reason }),
    });
    if (!h) resolve({ logs, errors, reason: "unavailable" });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

/* ─── Worker protocol ─────────────────────────────────────────────────── */

describe("LiveJS worker protocol (real WORKER_SOURCE in a vm realm)", () => {
  it("streams console output and finishes with done", async () => {
    const w = new VmWorker();
    const { logs, done } = await runRaw(w, 'console.log("hi", 1 + 1); console.warn({a: 1});');
    expect(logs).toEqual([
      ["log", "hi 2"],
      ["warn", '{\n  "a": 1\n}'],
    ]);
    expect(done).toMatchObject({ type: "done", runId: 1 });
    expect(done.timedOut).toBeUndefined();
  });

  it("supports top-level await", async () => {
    const w = new VmWorker();
    const { logs } = await runRaw(w, "const v = await Promise.resolve(42); console.log(v);");
    expect(logs).toEqual([["log", "42"]]);
  });

  it("reports thrown errors as error logs and still sends done", async () => {
    const w = new VmWorker();
    const { logs, done } = await runRaw(w, 'throw new Error("boom")');
    expect(logs[0][0]).toBe("error");
    expect(logs[0][1]).toContain("boom");
    expect(done.type).toBe("done");
  });

  it("keeps runtime helpers out of the shared global scope", () => {
    const w = new VmWorker();
    expect(w.global("emit")).toBeUndefined();
    expect(w.global("toParts")).toBeUndefined();
  });

  it("user globals named like runtime helpers do not break the runtime", async () => {
    const w = new VmWorker();
    await runRaw(w, hoistTopLevelBindings("const emit = 1; const post = 2; const toParts = 3;"), 1);
    const { logs } = await runRaw(w, 'console.log("still", emit + post + toParts)', 2);
    expect(logs).toEqual([["log", "still 6"]]);
  });

  it("times out a runaway async run and closes itself", async () => {
    const w = new VmWorker();
    const { logs, done } = await runRaw(w, "await new Promise(() => {});", 1, 30);
    expect(logs).toEqual([["error", "Execution timed out"]]);
    expect(done.timedOut).toBe(true);
    expect(w.closed).toBe(true);
  });

  it("ignores messages that are not runs", () => {
    const w = new VmWorker();
    const seen: unknown[] = [];
    w.addEventListener("message", (e: MessageEvent) => seen.push(e.data));
    (w as unknown as { postMessage: (m: unknown) => void }).postMessage({ type: "nope" });
    expect(seen).toEqual([]);
  });
});

/* ─── Scope persistence ───────────────────────────────────────────────── */

describe("LiveJS shared scope persistence", () => {
  it("top-level const/let/function/class from one run are visible to the next", async () => {
    const w = new VmWorker();
    const src1 = hoistTopLevelBindings(
      [
        "const a = 2, {b} = {b: 3};",
        "let [c] = [4]",
        "function sq(x) { return x * x }",
        "class Pt { constructor(x) { this.x = x } }",
        "var d",
      ].join("\n"),
    );
    await runRaw(w, src1, 1);
    const { logs } = await runRaw(w, "console.log(sq(a) + b + c, new Pt(7).x, typeof d)", 2);
    expect(logs).toEqual([["log", "11 7 undefined"]]);
  });

  it("re-running a block that declares const does not throw (REPL semantics)", async () => {
    const w = new VmWorker();
    const src = hoistTopLevelBindings("const n = (globalThis.n ?? 0) + 1;");
    await runRaw(w, src, 1);
    const second = await runRaw(w, src, 2);
    expect(second.logs).toEqual([]);
    expect(w.global("n")).toBe(2);
  });

  it("nested declarations stay local", async () => {
    const w = new VmWorker();
    await runRaw(w, hoistTopLevelBindings("{ const inner = 1 }\nfunction f() { const local = 2 }\nfor (let i = 0; i < 1; i++) {}"), 1);
    expect(w.global("inner")).toBeUndefined();
    expect(w.global("local")).toBeUndefined();
    expect(w.global("i")).toBeUndefined();
    expect(typeof w.global("f")).toBe("function");
  });
});

/* ─── Registry: sharing, queueing, reset, timeout ─────────────────────── */

describe("SharedScopeRegistry", () => {
  it("shares one worker per key across blocks, and isolates different keys", async () => {
    const made: VmWorker[] = [];
    const reg = new SharedScopeRegistry(() => {
      const w = new VmWorker();
      made.push(w);
      return w;
    });
    await runShared(reg, "doc-a", "const shared = 'from block 1'");
    const r2 = await runShared(reg, "doc-a", "console.log(shared)");
    expect(r2.logs).toEqual(["from block 1"]);
    const r3 = await runShared(reg, "doc-b", "console.log(typeof shared)");
    expect(r3.logs).toEqual(["undefined"]);
    expect(made).toHaveLength(2);
  });

  it("runs queued blocks one at a time, in start order", async () => {
    const reg = new SharedScopeRegistry(() => new VmWorker());
    const p1 = runShared(reg, "k", "await new Promise(r => setTimeout(r, 20)); const x = 1;");
    const p2 = runShared(reg, "k", "console.log(x + 1)");
    const [, r2] = await Promise.all([p1, p2]);
    expect(r2.logs).toEqual(["2"]);
  });

  it("Reset scope discards every global; the next run starts fresh", async () => {
    const made: VmWorker[] = [];
    const reg = new SharedScopeRegistry(() => {
      const w = new VmWorker();
      made.push(w);
      return w;
    });
    await runShared(reg, "k", "let counter = 41");
    expect(reg.isAlive("k")).toBe(true);
    reg.reset("k");
    expect(reg.isAlive("k")).toBe(false);
    expect(made[0].terminated).toBe(true);
    const r = await runShared(reg, "k", "console.log(typeof counter)");
    expect(r.logs).toEqual(["undefined"]);
    expect(made).toHaveLength(2);
  });

  it("reset ends in-flight and queued runs with reason 'reset'", async () => {
    const reg = new SharedScopeRegistry(() => new VmWorker());
    const p1 = runShared(reg, "k", "await new Promise(() => {})");
    const p2 = runShared(reg, "k", "console.log(1)");
    reg.reset("k");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.reason).toBe("reset");
    expect(r2.reason).toBe("reset");
  });

  it("a timed-out run reports 'timeout' and the scope is reset", async () => {
    const reg = new SharedScopeRegistry(() => new VmWorker());
    await runShared(reg, "k", "const keep = 1");
    const r = await runShared(reg, "k", "await new Promise(() => {})", 30);
    expect(r.reason).toBe("timeout");
    expect(reg.isAlive("k")).toBe(false);
    const after = await runShared(reg, "k", "console.log(typeof keep)");
    expect(after.logs).toEqual(["undefined"]);
  });

  it("the host kills a worker that never reports back", async () => {
    vi.useFakeTimers();
    const silent: WorkerLike & { terminated: boolean } = {
      terminated: false,
      postMessage() {},
      addEventListener() {},
      terminate() {
        this.terminated = true;
      },
    };
    const reg = new SharedScopeRegistry(() => silent);
    let reason = "";
    reg.run("k", "while(true){}", 100, { onLog() {}, onEnd: (r) => (reason = r) });
    vi.advanceTimersByTime(400);
    expect(reason).toBe("timeout");
    expect(silent.terminated).toBe(true);
  });

  it("detach drops a queued run without affecting others", async () => {
    const reg = new SharedScopeRegistry(() => new VmWorker());
    const p1 = runShared(reg, "k", "await new Promise(r => setTimeout(r, 10)); const y = 5");
    const onEnd = vi.fn();
    const h = reg.run("k", "globalThis.y = 999", 2000, { onLog() {}, onEnd });
    h!.detach();
    await p1;
    const r = await runShared(reg, "k", "console.log(y)");
    expect(r.logs).toEqual(["5"]);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("an unused scope is disposed after the idle period", () => {
    vi.useFakeTimers();
    const w = { postMessage() {}, addEventListener() {}, terminate: vi.fn() };
    const reg = new SharedScopeRegistry(() => w);
    const release = reg.acquire("k");
    reg.run("k", "1", SHARED_SCOPE_IDLE_MS * 10, { onLog() {}, onEnd() {} });
    release();
    vi.advanceTimersByTime(SHARED_SCOPE_IDLE_MS - 1);
    expect(w.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(w.terminate).toHaveBeenCalled();
  });

  it("re-acquiring before the idle period keeps the scope", () => {
    vi.useFakeTimers();
    const w = { postMessage() {}, addEventListener() {}, terminate: vi.fn() };
    const reg = new SharedScopeRegistry(() => w);
    const release = reg.acquire("k");
    reg.run("k", "1", SHARED_SCOPE_IDLE_MS * 10, { onLog() {}, onEnd() {} });
    release();
    reg.acquire("k");
    vi.advanceTimersByTime(SHARED_SCOPE_IDLE_MS * 2);
    expect(w.terminate).not.toHaveBeenCalled();
  });

  it("returns null when no worker can be created", () => {
    const reg = new SharedScopeRegistry(() => null);
    expect(reg.run("k", "1", 100, { onLog() {}, onEnd() {} })).toBeNull();
  });
});

/* ─── Meta parsing + transform details ───────────────────────────────── */

describe("sharedScopeName", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["height=200", null],
    ["shared", "default"],
    ["height=100 shared", "default"],
    ["shared=math height=100", "math"],
    ["unshared", null],
    ["sharedx", null],
  ])("%s → %s", (meta, expected) => {
    expect(sharedScopeName(meta)).toBe(expected);
  });
});

describe("hoistTopLevelBindings", () => {
  const run = (src: string) => {
    const ctx = vm.createContext({});
    vm.runInContext(`(async function(){\n${hoistTopLevelBindings(src)}\n})()`, ctx);
    return ctx as Record<string, unknown>;
  };

  it("rewrites declarations and leaves other code alone", () => {
    expect(hoistTopLevelBindings("const a = 1;")).toBe(
      '"a" in globalThis || (globalThis["a"] = void 0); 0, a = 1;',
    );
    expect(hoistTopLevelBindings("let b")).toBe(
      '"b" in globalThis || (globalThis["b"] = void 0); 0, b = void 0;',
    );
    expect(hoistTopLevelBindings("console.log(1)")).toBe("console.log(1)");
  });

  it("handles ASI-separated declarations", () => {
    const g = run("const a = 1\nconst b = a + 1\nlet c = b * 2");
    expect([g.a, g.b, g.c]).toEqual([1, 2, 4]);
  });

  it("handles multi-line initialisers (objects, arrows, calls, chains)", () => {
    const g = run(
      [
        "const obj = {",
        "  x: 1,",
        "  y: [1, 2],",
        "}",
        "const fn = (n) => {",
        "  const t = n + 1",
        "  return t",
        "}",
        "const total = [1, 2, 3]",
        "  .map((v) => v * 2)",
        "  .reduce((s, v) => s + v, 0)",
        "const r = fn(obj.x)",
      ].join("\n"),
    );
    expect(g.total).toBe(12);
    expect(g.r).toBe(2);
    expect(g.t).toBeUndefined();
  });

  it("does not touch declaration-like text in strings, templates, comments and regexes", () => {
    const src = [
      'const s = "const fake = 1";',
      "const tpl = `let x = ${'{'} ${1 + 1}`;",
      "// const commented = 1",
      "/* let alsoCommented = 2 */",
      "const re = /const y = 1/g;",
    ].join("\n");
    const g = run(src);
    expect(g.s).toBe("const fake = 1");
    expect(g.tpl).toBe("let x = { 2");
    expect(Object.prototype.toString.call(g.re)).toBe("[object RegExp]");
    expect(g.fake).toBeUndefined();
    expect(g.commented).toBeUndefined();
    expect(g.alsoCommented).toBeUndefined();
  });

  it("supports async functions and generators", () => {
    const g = run("async function load() { return 1 }\nfunction* gen() { yield 1 }");
    expect(typeof g.load).toBe("function");
    expect(typeof g.gen).toBe("function");
  });

  it("supports class with extends", () => {
    const g = run("class A { v() { return 1 } }\nclass B extends A {}\nconst ok = new B().v()");
    expect(g.ok).toBe(1);
  });

  it("keeps line numbers stable for error reporting", () => {
    const src = "function f() {}\nconst a = 1\nthrow new Error('x')";
    expect(hoistTopLevelBindings(src).split("\n")).toHaveLength(3);
  });

  it("persists bindings under a \"use strict\" prologue (with and without semicolon)", () => {
    const g = run('"use strict"; const value = 1, { b, c: [d = 2], ...rest } = { b: 3, c: [], e: 4 }\nclass K {}\nlet n');
    expect(g.value).toBe(1);
    expect([g.b, g.d, g.rest]).toEqual([3, 2, { e: 4 }]);
    expect(typeof g.K).toBe("function");
    expect("n" in g).toBe(true);
    // Keys and defaults are not bindings.
    expect(g.c).toBeUndefined();
    const g2 = run("'use strict'\nconst x = 5\nfunction f() { return x }\nconst y = f()");
    expect(g2.y).toBe(5);
    expect(typeof g2.f).toBe("function");
    // The directive is still the first statement, so the code stays strict.
    expect(hoistTopLevelBindings('"use strict"; const a = 1').startsWith('"use strict";')).toBe(true);
  });

  it("tokenizer distinguishes division from regex", () => {
    const toks = tokenize("a / b / c; x = /re/");
    expect(toks.filter((t) => t.type === "regex").map((t) => t.value)).toEqual(["/re/"]);
  });
});
