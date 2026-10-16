import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import {
  MAX_OUTPUT_CHARS,
  createRubyHandler,
  hardenWorkerScope,
  rubyErrorMessage,
  rubyProgram,
  rubyStringLiteral,
  rubyWasmUrl,
  type RubyWorkerMessage,
} from "../plugins/ruby/rubyRuntime";
import { instantiateRubyVm } from "../plugins/ruby/rubyVm";

describe("rubyRuntime helpers", () => {
  it("serves the wasm under the base path", () => {
    expect(rubyWasmUrl()).toBe("/ruby/ruby+stdlib.wasm");
    expect(rubyWasmUrl("/app")).toBe("/app/ruby/ruby+stdlib.wasm");
  });

  it("encodes any source as code points, never as a quoted literal", () => {
    expect(rubyStringLiteral("")).toBe('+""');
    expect(rubyStringLiteral('a"#{x}')).toBe('[97,34,35,123,120,125].pack("U*")');
    expect(rubyStringLiteral("😀")).toBe('[128512].pack("U*")');
    expect(rubyStringLiteral("\ud800")).toBe('[65533].pack("U*")');
    expect(rubyProgram("1")).toContain('TOPLEVEL_BINDING.eval(src, "block", 1)');
  });

  it("drops the wrapper's backtrace frames from errors", () => {
    const err = new Error(
      "block:2:in '<main>': undefined local variable or method 'foo' for main (NameError)\neval:5:in 'Binding#eval'\n-e:in 'Kernel.eval'",
    );
    expect(rubyErrorMessage(err)).toBe("block:2:in '<main>': undefined local variable or method 'foo' for main (NameError)");
  });

  it("removes network and storage APIs from the worker scope, prototypes included", () => {
    class Base {
      fetch() {
        return "net";
      }
    }
    const scope = Object.create(Base.prototype) as Record<string, unknown>;
    scope.indexedDB = {};
    scope.XMLHttpRequest = function XHR() {};
    scope.navigator = Object.create({ storage: {}, userAgent: "x" });
    scope.postMessage = () => {};
    hardenWorkerScope(scope);
    expect(scope.fetch).toBeUndefined();
    expect(Object.getPrototypeOf(scope).fetch).toBeUndefined();
    expect(scope.indexedDB).toBeUndefined();
    expect(scope.XMLHttpRequest).toBeUndefined();
    expect((scope.navigator as { storage?: unknown }).storage).toBeUndefined();
    expect((scope.navigator as { userAgent?: unknown }).userAgent).toBe("x");
    expect(typeof scope.postMessage).toBe("function");
  });

  it("caps captured output", async () => {
    const msgs: RubyWorkerMessage[] = [];
    const handle = createRubyHandler({
      loadVm: async (printer) => ({
        eval: () => {
          for (let i = 0; i < 5; i++) printer.stdout("x".repeat(MAX_OUTPUT_CHARS / 2));
          return { toString: () => "", call: () => ({ toString: () => "true", call: () => ({}) as never }) };
        },
      }),
      post: (m) => msgs.push(m),
    });
    await handle({ type: "run", runId: 1, source: "" });
    const text = msgs.flatMap((m) => (m.type === "output" ? [m.text] : [])).join("");
    expect(text.length).toBeLessThan(MAX_OUTPUT_CHARS + 100);
    expect(text).toContain("output truncated");
    expect(msgs.at(-1)?.type).toBe("done");
  });

  it("ignores malformed messages", async () => {
    const msgs: RubyWorkerMessage[] = [];
    const handle = createRubyHandler({ loadVm: () => Promise.reject(new Error("no")), post: (m) => msgs.push(m) });
    await handle(null);
    await handle({ type: "other", runId: 1 });
    expect(msgs).toEqual([]);
  });

  it("reports a runtime that fails to load", async () => {
    const msgs: RubyWorkerMessage[] = [];
    const handle = createRubyHandler({ loadVm: () => Promise.reject(new Error("ruby.wasm: HTTP 404")), post: (m) => msgs.push(m) });
    await handle({ type: "run", runId: 7, source: "1" });
    expect(msgs.map((m) => m.type)).toEqual(["error", "done"]);
    expect(msgs[0]).toMatchObject({ message: "ruby.wasm: HTTP 404" });
  });
});

describe("live-ruby on the real ruby.wasm runtime", () => {
  let mod: WebAssembly.Module;
  beforeAll(async () => {
    mod = await WebAssembly.compile(readFileSync("node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm"));
  }, 120_000);

  async function run(source: string, runId = 1): Promise<RubyWorkerMessage[]> {
    const msgs: RubyWorkerMessage[] = [];
    const handle = createRubyHandler({ loadVm: (p) => instantiateRubyVm(mod, p), post: (m) => msgs.push(m) });
    await handle({ type: "run", runId, source });
    return msgs;
  }

  it("prints stdout/stderr, loads the stdlib and shows the last value", async () => {
    const msgs = await run('puts "hi #{1 + 1}"\nwarn "careful"\nrequire "json"\n{a: [1, "x"]}.to_json');
    expect(msgs[0]).toEqual({ type: "ready", runId: 1 });
    expect(msgs).toContainEqual({ type: "output", runId: 1, stream: "out", text: "hi 2\n" });
    expect(msgs).toContainEqual({ type: "output", runId: 1, stream: "err", text: "careful\n" });
    expect(msgs).toContainEqual({ type: "result", runId: 1, text: '"{\\"a\\":[1,\\"x\\"]}"' });
    expect(msgs.at(-1)?.type).toBe("done");
  }, 60_000);

  it("reports errors with block line numbers, and nil results stay silent", async () => {
    const msgs = await run("x = 1\nfoo");
    const err = msgs.find((m) => m.type === "error");
    expect(err && "message" in err ? err.message : "").toMatch(/^block:2:.*undefined local variable or method 'foo'.*\(NameError\)$/);
    expect((await run("nil")).some((m) => m.type === "result")).toBe(false);
  }, 60_000);

  it("refuses the JS bridge with a clear error", async () => {
    const msgs = await run('require "json"\nrequire "js"');
    const err = msgs.find((m) => m.type === "error");
    expect(err && "message" in err ? err.message : "").toMatch(/JS bridge .*not available.*\(LoadError\)/);
  }, 60_000);

  it("cuts the JS bridge at the VM boundary, whatever path loads it", async () => {
    for (const src of [
      'Kernel.send(:require, "js")\nJS.global',
      'method(:require).super_method.call("js")\nJS.global[:fetch]',
      'load "/bundle/gems/js-2.10.1/lib/js.rb"\nJS.eval("1")',
    ]) {
      const msgs = await run(src);
      const err = msgs.find((m) => m.type === "error");
      expect(err && "message" in err ? err.message : "", src).toMatch(/JS bridge/);
      expect(msgs.some((m) => m.type === "result"), src).toBe(false);
    }
    // The next run is unaffected.
    expect(await run("1 + 1")).toContainEqual({ type: "result", runId: 1, text: "2" });
  }, 120_000);

  it("gives every run a fresh VM", async () => {
    await run("$leak = 42");
    const msgs = await run("$leak.inspect");
    expect(msgs).toContainEqual({ type: "result", runId: 1, text: '"nil"' });
  }, 60_000);

  it("runs code with quotes, interpolation markers and heredoc terminators verbatim", async () => {
    const msgs = await run('s = <<~EOS\n  a "#{1}" \'b\'\nEOS\nputs s\n"\\\\ end"');
    expect(msgs).toContainEqual({ type: "output", runId: 1, stream: "out", text: "a \"1\" 'b'\n" });
    expect(msgs).toContainEqual({ type: "result", runId: 1, text: '"\\\\ end"' });
  }, 60_000);
});
