/**
 * Live Ruby Web Worker. Compiles the self-hosted ruby.wasm once (same-origin
 * — the app's CSP blocks CDNs; works offline), then strips the worker's
 * network/storage APIs and gives every run a fresh VM. All execution logic
 * lives in ./rubyRuntime so it can be unit-tested in Node.
 */
import { createRubyHandler, hardenWorkerScope, rubyWasmUrl } from "./rubyRuntime";
import { instantiateRubyVm } from "./rubyVm";

const post = self.postMessage.bind(self);
let compiled: Promise<WebAssembly.Module> | null = null;

function compile(): Promise<WebAssembly.Module> {
  if (!compiled) {
    compiled = (async () => {
      const res = await fetch(rubyWasmUrl(import.meta.env.BASE_URL));
      if (!res.ok) throw new Error(`ruby.wasm: HTTP ${res.status}`);
      const mod =
        typeof WebAssembly.compileStreaming === "function"
          ? await WebAssembly.compileStreaming(res)
          : await WebAssembly.compile(await res.arrayBuffer());
      // From here on Ruby code may run: no network, no origin storage.
      hardenWorkerScope(self);
      return mod;
    })();
    compiled.catch(() => {
      compiled = null;
    });
  }
  return compiled;
}

const handle = createRubyHandler({
  loadVm: async (printer) => instantiateRubyVm(await compile(), printer),
  post: (msg) => post(msg),
});

self.addEventListener("message", (e: MessageEvent) => {
  void handle(e.data);
});
