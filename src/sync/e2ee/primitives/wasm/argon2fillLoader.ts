/**
 * The WebAssembly Argon2id memory fill (./argon2fill.c, plan W4.20) for
 * ../argon2.ts. Synchronous: the module is 4 KB, so `new WebAssembly.Module`
 * is allowed on every thread (engines cap synchronous compiles at a few MB),
 * and argon2id stays a plain function.
 *
 * Each derivation gets a fresh instance and so a fresh memory; nothing holds
 * it afterwards, so its 46–64 MiB go with the instance instead of staying
 * reserved for the page's lifetime.
 *
 * The bytes ship inside this bundle; the unit test holds them to the sha256
 * the generator recorded (scripts/crypto/build-argon2-wasm.mjs --check
 * rebuilds them from the C source).
 */
import { ARGON2_FILL_WASM_B64 } from "./argon2fillWasm";

export interface Argon2FillWasm {
  /** The blocks, lane after lane, as 32-bit words (in the instance's memory). */
  words: Uint32Array;
  /** Fill passes 0 … t-1 over p lanes of 4 × segment blocks; the first two blocks of each lane must be in `words`. */
  fill(p: number, segment: number, t: number): void;
}

const PAGE = 65536;
const MAX_BYTES = 4 * 1024 * 1024 * 1024 - PAGE;

let module: WebAssembly.Module | null | undefined;

/** Force the TypeScript fill (tests: both paths must give the same bytes). */
let disabled = false;
export function setArgon2WasmDisabled(off: boolean): void {
  disabled = off;
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function compiled(): WebAssembly.Module | null {
  if (module !== undefined) return module;
  module = null;
  try {
    if (typeof WebAssembly !== "object") return null;
    module = new WebAssembly.Module(decode(ARGON2_FILL_WASM_B64) as BufferSource);
  } catch {
    // why: no WebAssembly here (a CSP without 'wasm-unsafe-eval', an old engine): the TypeScript fill gives the same bytes
    module = null;
  }
  return module;
}

/** A fresh fill over `bytes` bytes of blocks, or null when WebAssembly can't be used (the caller runs the TypeScript fill). */
export function argon2FillWasm(bytes: number): Argon2FillWasm | null {
  if (disabled) return null;
  const m = compiled();
  if (!m) return null;
  let inst: WebAssembly.Instance;
  try {
    inst = new WebAssembly.Instance(m, {});
  } catch {
    // why: instantiation refused (memory pressure): the TypeScript fill gives the same bytes
    return null;
  }
  const memory = inst.exports.memory as WebAssembly.Memory;
  const base = Math.ceil((inst.exports.__heap_base as WebAssembly.Global).value / 1024) * 1024;
  const need = base + bytes;
  if (need > MAX_BYTES) return null;
  const have = memory.buffer.byteLength;
  if (need > have) {
    try {
      memory.grow(Math.ceil((need - have) / PAGE));
    } catch {
      // why: the engine refused the memory (RangeError): the TypeScript fill tries with a plain array
      return null;
    }
  }
  const fill = inst.exports.fill as (base: number, p: number, segment: number, t: number) => void;
  return {
    words: new Uint32Array(memory.buffer, base, bytes / 4),
    fill: (p, segment, t) => fill(base, p, segment, t),
  };
}
