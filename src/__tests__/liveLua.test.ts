// @vitest-environment node
/**
 * Live Lua block — worker message protocol. The handler in luaRuntime.ts is
 * exactly what lua.worker.ts runs; here it is driven directly (no Worker)
 * against (a) a mock factory for protocol edge cases and (b) the REAL wasmoon
 * runtime, loading the same glue.wasm the app bundles.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { LuaFactory } from "wasmoon";
import {
  createLuaHandler,
  LUA_PRELUDE,
  MAX_OUTPUT_CHARS,
  type LuaFactoryLike,
  type LuaWorkerMessage,
} from "../plugins/lua/luaRuntime";

const require = createRequire(import.meta.url);
const wasmPath = join(dirname(require.resolve("wasmoon/package.json")), "dist", "glue.wasm");

let realFactory: LuaFactory | null = null;
const loadReal = async () => (realFactory ??= new LuaFactory(wasmPath)) as unknown as LuaFactoryLike;

async function runReal(source: string, timeoutMs = 2000): Promise<LuaWorkerMessage[]> {
  const msgs: LuaWorkerMessage[] = [];
  const handle = createLuaHandler({ loadFactory: loadReal, post: (m) => msgs.push(m) });
  await handle({ type: "run", runId: 7, source, timeoutMs });
  return msgs;
}

const stdout = (msgs: LuaWorkerMessage[]) =>
  msgs.filter((m) => m.type === "output").map((m) => (m as { text: string }).text).join("");

describe("live-lua protocol (real wasmoon)", () => {
  it("runs print(1+1) and reports done", async () => {
    const msgs = await runReal("print(1+1)");
    expect(stdout(msgs)).toBe("2\n");
    expect(msgs.every((m) => m.runId === 7)).toBe(true);
    expect(msgs[msgs.length - 1].type).toBe("done");
    expect(msgs.some((m) => m.type === "error")).toBe(false);
  });

  it("captures multi-arg print, io.write and return values", async () => {
    const msgs = await runReal('print("a", 1, nil, true)\nio.write("x", 2)\nio.write("y\\n")\nreturn 42, "ok"');
    expect(stdout(msgs)).toBe("a\t1\tnil\ttrue\nx2y\n");
    expect(msgs.find((m) => m.type === "result")).toMatchObject({ text: '42, "ok"' });
  });

  it("reports runtime errors with the block chunk name and line", async () => {
    const msgs = await runReal('print("before")\nerror("boom")');
    expect(stdout(msgs)).toBe("before\n");
    const err = msgs.find((m) => m.type === "error") as { message: string };
    expect(err.message).toMatch(/block:2: boom/);
  });

  it("reports syntax errors", async () => {
    const msgs = await runReal("local = 1");
    expect(msgs.find((m) => m.type === "error")).toBeTruthy();
    expect(msgs[msgs.length - 1].type).toBe("done");
  });

  it("aborts infinite loops via the instruction-count timeout", async () => {
    const msgs = await runReal("while true do end", 150);
    const err = msgs.find((m) => m.type === "error") as { message: string };
    expect(err.message).toMatch(/timed out after 150 ms/);
    expect(msgs[msgs.length - 1].type).toBe("done");
  });

  it("removes process / file escapes and the internal output hook", async () => {
    const msgs = await runReal(
      "print(os.exit, os.execute, io.open, io.popen, require, dofile, loadfile, package, __lumen_emit)",
    );
    expect(stdout(msgs)).toBe(Array(9).fill("nil").join("\t") + "\n");
  });

  it("isolates state between runs", async () => {
    await runReal("leaked = 123");
    expect(stdout(await runReal("print(leaked)"))).toBe("nil\n");
  });

  it("supports the standard string / table / math libraries", async () => {
    const msgs = await runReal(
      'local t = {} for i = 1, 5 do t[#t+1] = i * i end\nprint(table.concat(t, ","), string.upper("lua"), math.floor(3.7))',
    );
    expect(stdout(msgs)).toBe("1,4,9,16,25\tLUA\t3\n");
  });
});

describe("live-lua protocol (mock engine)", () => {
  function mockFactory(behaviour: (emit: (s: string) => void) => Promise<unknown[]>) {
    let emit: (s: string) => void = () => {};
    let closed = false;
    const prelude: string[] = [];
    const factory: LuaFactoryLike = {
      async createEngine() {
        return {
          global: {
            set: (name, value) => {
              if (name === "__lumen_emit") emit = value as (s: string) => void;
            },
            newThread: () => ({ loadString: () => {}, run: () => behaviour(emit) }),
            close: () => {
              closed = true;
            },
          },
          doString: async (code: string) => {
            prelude.push(code);
          },
        };
      },
    };
    return { factory, isClosed: () => closed, prelude };
  }

  it("ignores messages that are not run requests", async () => {
    const msgs: LuaWorkerMessage[] = [];
    const handle = createLuaHandler({ loadFactory: async () => mockFactory(async () => []).factory, post: (m) => msgs.push(m) });
    await handle(null);
    await handle({ type: "ping" });
    await handle({ type: "run" });
    expect(msgs).toEqual([]);
  });

  it("installs the prelude, closes the engine and reports elapsed time", async () => {
    const mock = mockFactory(async (emit) => {
      emit("hi\n");
      return [];
    });
    const msgs: LuaWorkerMessage[] = [];
    let t = 1000;
    const handle = createLuaHandler({ loadFactory: async () => mock.factory, post: (m) => msgs.push(m), now: () => (t += 5) });
    await handle({ type: "run", runId: 3, source: "x", timeoutMs: 10 });
    expect(mock.prelude).toEqual([LUA_PRELUDE]);
    expect(mock.isClosed()).toBe(true);
    expect(msgs).toEqual([
      { type: "output", runId: 3, text: "hi\n" },
      { type: "done", runId: 3, ms: 5 },
    ]);
  });

  it("caps captured output", async () => {
    const mock = mockFactory(async (emit) => {
      for (let i = 0; i < 50; i++) emit("x".repeat(10_000));
      return [];
    });
    const msgs: LuaWorkerMessage[] = [];
    await createLuaHandler({ loadFactory: async () => mock.factory, post: (m) => msgs.push(m) })({
      type: "run",
      runId: 1,
      source: "",
      timeoutMs: 10,
    });
    const out = stdout(msgs);
    expect(out.length).toBeLessThan(MAX_OUTPUT_CHARS + 100);
    expect(out).toMatch(/output truncated/);
  });

  it("turns a runtime load failure into an error + done", async () => {
    const msgs: LuaWorkerMessage[] = [];
    await createLuaHandler({
      loadFactory: async () => {
        throw new Error("wasm fetch failed");
      },
      post: (m) => msgs.push(m),
    })({ type: "run", runId: 2, source: "", timeoutMs: 10 });
    expect(msgs.map((m) => m.type)).toEqual(["error", "done"]);
    expect(msgs[0]).toMatchObject({ message: "wasm fetch failed" });
  });
});
