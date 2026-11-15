/**
 * Finding X-BL-3 (W10.D18): kdf.ts's comment listed OWASP Argon2id options
 * (12 MiB × 3, 9 MiB × 4, 7 MiB × 5) that come to 35–36 MiB × passes, below
 * the spec §2 floor of 37 MiB, so a vault written with them would not open.
 * The floor stays; every option the code or its comment documents must meet it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARGON2_DEFAULT, ARGON2_MIN_COST_KIB, ARGON2_MIN_MEMORY_KIB, validateKdfParams } from "../sync/e2ee/kdf";
import { ARGON2_OPTIONS } from "../sync/e2ee/kdfCalibrate";

const SALT = "AQEBAQEBAQEBAQEBAQEBAQ"; // 16 bytes, b64url

/** Every "N MiB × M" pair written in a source file's comments. */
function documentedOptions(file: string): Array<{ memoryKiB: number; iterations: number; text: string }> {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/(\d+) MiB × (\d+)/g)].map((m) => ({ memoryKiB: Number(m[1]) * 1024, iterations: Number(m[2]), text: m[0] }));
}

describe("Argon2id options against the spec §2 floor (X-BL-3)", () => {
  it("the floor is the spec's: 7 MiB of memory, 37 MiB of memory × passes", () => {
    expect(ARGON2_MIN_MEMORY_KIB).toBe(7 * 1024);
    expect(ARGON2_MIN_COST_KIB).toBe(37 * 1024);
  });

  it("every option kdf.ts's comment documents meets the floor and opens", () => {
    const options = documentedOptions("src/sync/e2ee/kdf.ts");
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(o.memoryKiB, o.text).toBeGreaterThanOrEqual(ARGON2_MIN_MEMORY_KIB);
      expect(o.memoryKiB * o.iterations, o.text).toBeGreaterThanOrEqual(ARGON2_MIN_COST_KIB);
      expect(() => validateKdfParams({ alg: "argon2id", memoryKiB: o.memoryKiB, iterations: o.iterations, parallelism: 1, salt: SALT }), o.text).not.toThrow();
    }
  });

  it("the default and every calibration option meet the floor and open", () => {
    for (const o of [ARGON2_DEFAULT, ...ARGON2_OPTIONS]) {
      expect(o.memoryKiB).toBeGreaterThanOrEqual(ARGON2_MIN_MEMORY_KIB);
      expect(o.memoryKiB * o.iterations).toBeGreaterThanOrEqual(ARGON2_MIN_COST_KIB);
      expect(validateKdfParams({ alg: "argon2id", ...o, salt: SALT })).toMatchObject({ alg: "argon2id", memoryKiB: o.memoryKiB, iterations: o.iterations });
    }
  });

  it("OWASP's cheaper options are refused by the floor, not lowered to fit it", () => {
    for (const [mib, t] of [
      [12, 3],
      [9, 4],
      [7, 5],
    ] as const) {
      expect(() => validateKdfParams({ alg: "argon2id", memoryKiB: mib * 1024, iterations: t, parallelism: 1, salt: SALT })).toThrow();
    }
  });
});
