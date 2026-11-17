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
import { swallowed } from "../../../../lib/logger";

export interface Argon2FillWasm {
  /** The blocks, lane after lane, as 32-bit words (in the instance's memory). */
  words: Uint32Array;
  /** Fill passes 0 … t-1 over p lanes of 4 × segment blocks; the first two blocks of each lane must be in `words`. */
  fill(p: number, segment: number, t: number): void;
}

const PAGE = 65536;
const MAX_BYTES = 4 * 1024 * 1024 * 1024 - PAGE;

let module: WebAssembly.Module | null | undefined;

/** Test hook (not a feature seam): force the TypeScript fill, so a test can hold both paths to the same bytes. */
let disabled = false;
export function __setArgon2WasmDisabledForTests(off: boolean): void {
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
  } catch (e) {
    // why: no WebAssembly here (a CSP without 'wasm-unsafe-eval', an old engine): the TypeScript fill gives the same bytes
    swallowed("sync/e2ee/primitives/argon2: no WebAssembly; Argon2id runs the TypeScript fill (about 12 times slower)", e);
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
  } catch (e) {
    // why: instantiation refused (memory pressure): the TypeScript fill gives the same bytes
    swallowed("sync/e2ee/primitives/argon2: the WebAssembly instance was refused; the TypeScript fill runs", e);
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
    } catch (e) {
      // why: the engine refused the memory (RangeError): the TypeScript fill tries with a plain array
      swallowed("sync/e2ee/primitives/argon2: the WebAssembly memory could not grow; the TypeScript fill runs", e);
      return null;
    }
  }
  const fill = inst.exports.fill as (base: number, p: number, segment: number, t: number) => void;
  return {
    words: new Uint32Array(memory.buffer, base, bytes / 4),
    fill: (p, segment, t) => fill(base, p, segment, t),
  };
}
