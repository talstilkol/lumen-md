/**
 * The live-js worker's lockdown, run for real: WORKER_SOURCE in a blob:
 * Worker (needs a browser; the Chromium runner has one). A lock that does
 * not take used to be swallowed by an empty catch, so the run went ahead with
 * the API still reachable. Now every run is refused and names the hole.
 */
import { describe, it, expect } from "vitest";
import { WORKER_SOURCE } from "../plugins/liveJsWorkerSource";

type Msg = { type: string; runId?: number; level?: string; parts?: string[] };

/** Start the worker (after `prelude`, which runs first in the same scope), run `source`, collect its messages until "done". */
function run(source: string, prelude = ""): Promise<Msg[]> {
  const url = URL.createObjectURL(new Blob([prelude + "\n" + WORKER_SOURCE], { type: "text/javascript" }));
  const w = new Worker(url);
  const got: Msg[] = [];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      w.terminate();
      reject(new Error("no done: " + JSON.stringify(got)));
    }, 10_000);
    w.onerror = (e) => {
      clearTimeout(t);
      w.terminate();
      reject(new Error("worker error: " + e.message));
    };
    w.onmessage = (e: MessageEvent<Msg>) => {
      got.push(e.data);
      if (e.data.type === "done") {
        clearTimeout(t);
        w.terminate();
        URL.revokeObjectURL(url);
        resolve(got);
      }
    };
    w.postMessage({ type: "run", runId: 1, source, timeoutMs: 5000 });
  });
}

const errors = (m: Msg[]) => m.filter((x) => x.level === "error").map((x) => (x.parts ?? []).join(" "));
const logs = (m: Msg[]) => m.filter((x) => x.level === "log").map((x) => (x.parts ?? []).join(" "));

// skip-reason: the lockdown runs in a real blob: Worker, which Node and happy-dom lack; the Chromium runner has one | task: W10.E13 | until: 2027-05-16
describe.runIf(typeof Worker === "function" && typeof Blob === "function")("live-js worker lockdown (real Worker)", () => {
  it("locks every API and runs: no gap in a normal worker", async () => {
    const m = await run(`let compiled = "compiled"; try { eval("1"); } catch (e) { compiled = "refused"; } console.log(typeof fetch, typeof indexedDB, compiled);`);
    expect(errors(m)).toEqual([]);
    expect(logs(m)).toEqual(["undefined undefined refused"]);
  });

  it("refuses every run when a network API cannot be removed (non-configurable fetch)", async () => {
    const prelude = `Object.defineProperty(self, "fetch", { value: self.fetch, writable: false, configurable: false });`;
    const m = await run(`console.log("ran");`, prelude);
    expect(logs(m)).toEqual([]);
    expect(errors(m)).toEqual([expect.stringContaining("live-js refuses to run: the sandbox could not remove fetch")]);
  });

  it("refuses every run when a string-compiling API cannot be replaced (non-configurable eval)", async () => {
    const prelude = `Object.defineProperty(self, "eval", { value: self.eval, writable: false, configurable: false });`;
    const m = await run(`console.log("ran");`, prelude);
    expect(logs(m)).toEqual([]);
    expect(errors(m).join("\n")).toContain("could not remove eval");
  });
});
