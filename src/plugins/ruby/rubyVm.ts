/**
 * Instantiate a ruby.wasm VM from an already-compiled module, with stdout /
 * stderr routed to `printer` and an empty in-memory WASI filesystem (no host
 * files). Used by the worker and by the real-runtime unit test.
 */
import { File, OpenFile, PreopenDirectory, WASI } from "@bjorn3/browser_wasi_shim";
import { RubyVM, consolePrinter } from "@ruby/wasm-wasi";
import type { RubyPrinter, RubyVmLike } from "./rubyRuntime";

export async function instantiateRubyVm(module: WebAssembly.Module, printer: RubyPrinter): Promise<RubyVmLike> {
  const fds = [
    new OpenFile(new File([])), // stdin: empty
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new PreopenDirectory("/", new Map()),
  ];
  const wasi = new WASI([], [], fds, { debug: false });
  const out = consolePrinter({ stdout: (s: string) => printer.stdout(s), stderr: (s: string) => printer.stderr(s) });
  const { vm } = await RubyVM.instantiateModule({
    module,
    wasip1: wasi,
    addToImports: (imports: WebAssembly.Imports) => {
      out.addToImports(imports);
      disableJsBridge(imports);
    },
    setMemory: (memory: WebAssembly.Memory) => out.setMemory(memory),
  });
  return vm as unknown as RubyVmLike;
}

export const JS_BRIDGE_DISABLED = "The JS bridge is not available in Lumen's sandboxed Ruby";

/**
 * Cut Ruby's `JS` bridge at the VM boundary: every host function the `js`
 * extension calls (eval-js, global-this, reflect-*, …) throws. However Ruby
 * code reaches the extension (`require "js"`, `Kernel.send(:require, …)`,
 * `load`, …), it can't touch JavaScript — the worker's globals included.
 * Each run uses a fresh VM, so a VM that unwound through a refusal is
 * thrown away anyway.
 */
export function disableJsBridge(imports: WebAssembly.Imports): void {
  const host = imports["rb-js-abi-host"] as Record<string, unknown> | undefined;
  if (!host) return;
  for (const name of Object.keys(host)) {
    if (name === "rb_wasm_throw_prohibit_rewind_exception") continue; // VM-internal, not JS access
    host[name] = () => {
      throw new Error(JS_BRIDGE_DISABLED);
    };
  }
}
