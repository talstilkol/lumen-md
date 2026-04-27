import { describe, it, expect } from "vitest";
import { randomChoice, randomId, randomInt } from "../lib/cryptoRandom";

describe("cryptoRandom", () => {
  it("randomId returns a hex string of the requested byte length", () => {
    const id = randomId(8);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    const id3 = randomId(3);
    expect(id3).toMatch(/^[0-9a-f]{6}$/);
  });

  it("randomId produces unique values across many invocations", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(randomId(8));
    // Vanishingly small chance of collision in 1k 64-bit ids.
    expect(set.size).toBe(1000);
  });

  it("randomInt stays within [0, max)", () => {
    for (let i = 0; i < 200; i++) {
      const n = randomInt(50);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(50);
    }
  });

  it("randomInt returns 0 for non-positive or non-finite max", () => {
    expect(randomInt(0)).toBe(0);
    expect(randomInt(-5)).toBe(0);
    expect(randomInt(Number.NaN)).toBe(0);
    expect(randomInt(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("randomChoice returns an element from the array", () => {
    const arr = ["a", "b", "c", "d", "e"] as const;
    for (let i = 0; i < 50; i++) {
      const pick = randomChoice(arr);
      expect(arr).toContain(pick);
    }
  });
});
