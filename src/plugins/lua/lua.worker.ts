/**
 * Live Lua Web Worker. Loads wasmoon (Lua 5.4 → WebAssembly) with its
 * `glue.wasm` served SAME-ORIGIN as a bundled Vite asset — no CDN, which the
 * app's CSP would block (wasmoon's own default fetches from unpkg). All
 * execution logic lives in ./luaRuntime so it can be unit-tested in Node.
 */
import { LuaFactory } from "wasmoon";
import wasmUrl from "wasmoon/dist/glue.wasm?url";
import { createLuaHandler, type LuaFactoryLike } from "./luaRuntime";

// wasmoon awaits `setImmediate` between coroutine yields; browsers lack it.
const g = globalThis as unknown as { setImmediate?: (fn: () => void) => void };
if (typeof g.setImmediate !== "function") g.setImmediate = (fn) => setTimeout(fn, 0);

let factory: LuaFactory | null = null;

const handle = createLuaHandler({
  // One factory per worker: the wasm module compiles once, every run still
  // gets a brand-new Lua state.
  loadFactory: async () => (factory ??= new LuaFactory(wasmUrl)) as unknown as LuaFactoryLike,
  post: (msg) => self.postMessage(msg),
});

self.addEventListener("message", (e: MessageEvent) => {
  void handle(e.data);
});
