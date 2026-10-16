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
    addToImports: (imports: WebAssembly.Imports) => out.addToImports(imports),
    setMemory: (memory: WebAssembly.Memory) => out.setMemory(memory),
  });
  return vm as unknown as RubyVmLike;
}
