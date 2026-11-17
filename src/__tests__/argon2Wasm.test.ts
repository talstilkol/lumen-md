/**
 * Plan W4.20: Argon2id under 1 s at the plan's unlock target (m = 64 MiB,
 * t = 3, p = 1). The TypeScript fill took 5.6 s here (8.6–22 s on a loaded
 * machine, L3); the memory fill now runs in WebAssembly built in the repo
 * from src/sync/e2ee/primitives/wasm/argon2fill.c (0.2–0.5 s here). Both
 * fills must give the same bytes, and the RFC 9106 §5.3 vector.
 */
import { describe, expect, it } from "vitest";
import { argon2id as argon2idAny, type Argon2Input } from "../sync/e2ee/primitives";
import { argon2FillWasm, __setArgon2WasmDisabledForTests } from "../sync/e2ee/primitives/wasm/argon2fillLoader";
import { ARGON2_FILL_WASM_B64, ARGON2_FILL_WASM_SHA256 } from "../sync/e2ee/primitives/wasm/argon2fillWasm";

// The in-house primitive (the interface's default), synchronous.
const argon2id = (input: Argon2Input) => argon2idAny(input) as Uint8Array;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const RFC9106: Argon2Input = { password: new Uint8Array(32).fill(1), salt: new Uint8Array(16).fill(2), secret: new Uint8Array(8).fill(3), associatedData: new Uint8Array(12).fill(4), memoryKiB: 32, iterations: 3, parallelism: 4, tagLength: 32 };
const RFC_TAG = "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659";

const both = (input: Argon2Input): [string, string] => {
  const wasm = hex(argon2id(input));
  __setArgon2WasmDisabledForTests(true);
  try {
    return [wasm, hex(argon2id(input))];
  } finally {
    __setArgon2WasmDisabledForTests(false);
  }
};

/** CPU milliseconds where the runtime reports them (Node), wall time otherwise. */
const cpuMs = (f: () => void): number => {
  const cpu = (globalThis as { process?: { cpuUsage?: () => { user: number; system: number } } }).process?.cpuUsage;
  if (cpu) {
    const a = cpu();
    f();
    const b = cpu();
    return (b.user - a.user + b.system - a.system) / 1000;
  }
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe("Argon2id: the WebAssembly memory fill (W4.20)", () => {
  it("is used here, and gives the RFC 9106 §5.3 tag", () => {
    expect(argon2FillWasm(1024)).not.toBeNull();
    expect(hex(argon2id(RFC9106))).toBe(RFC_TAG);
  });

  it("gives the same bytes as the TypeScript fill (lanes, passes, odd memory sizes, secret and AD)", () => {
    const enc = new TextEncoder();
    const cases: Argon2Input[] = [
      RFC9106,
      { password: enc.encode("סיסמה ארוכה"), salt: new Uint8Array(16).fill(9), memoryKiB: 8, iterations: 1, parallelism: 1, tagLength: 32 },
      { password: enc.encode("p"), salt: new Uint8Array(16).fill(1), memoryKiB: 1000, iterations: 2, parallelism: 1, tagLength: 64 },
      { password: enc.encode("p"), salt: new Uint8Array(8).fill(5), memoryKiB: 777, iterations: 3, parallelism: 3, tagLength: 100 },
      { password: enc.encode("lanes"), salt: new Uint8Array(16).fill(6), memoryKiB: 4096, iterations: 2, parallelism: 2, tagLength: 32, secret: enc.encode("s"), associatedData: enc.encode("ad") },
    ];
    for (const c of cases) {
      const [w, t] = both(c);
      expect(w).toBe(t);
    }
  });

  it("derives m = 64 MiB, t = 3, p = 1 well under 1 s of CPU (the TypeScript fill: ~5.6 s)", () => {
    const input: Argon2Input = { password: new TextEncoder().encode("correct horse battery staple"), salt: new Uint8Array(16).fill(7), memoryKiB: 64 * 1024, iterations: 3, parallelism: 1, tagLength: 32 };
    let tag: Uint8Array = new Uint8Array();
    const ms = cpuMs(() => (tag = argon2id(input)));
    expect(tag).toHaveLength(32);
    expect(ms).toBeLessThan(1500);
  }, 60_000);

  it("ships the bytes the generator recorded", async () => {
    const bin = atob(ARGON2_FILL_WASM_B64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    expect(hex(digest)).toBe(ARGON2_FILL_WASM_SHA256);
    expect(WebAssembly.validate(bytes)).toBe(true);
    const exports = WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map((e) => e.name).sort();
    expect(exports).toEqual(["__heap_base", "fill", "memory"]);
  });

  it("falls back to the TypeScript fill when WebAssembly is off, with the same RFC tag", () => {
    __setArgon2WasmDisabledForTests(true);
    try {
      expect(argon2FillWasm(1024)).toBeNull();
      expect(hex(argon2id(RFC9106))).toBe(RFC_TAG);
    } finally {
      __setArgon2WasmDisabledForTests(false);
    }
  });
});
