/**
 * Tests for the vault encryption module's pure helper functions.
 * IndexedDB-dependent functions are tested separately in encryption.test.ts.
 */

import { describe, it, expect } from "vitest";
import { generateRecoveryPhrase } from "../storage/vault";

describe("vault — recovery phrase", () => {
  it("generates a 12-word phrase by default", () => {
    const phrase = generateRecoveryPhrase();
    const words = phrase.split(" ");
    expect(words).toHaveLength(12);
  });

  it("generates different phrases on each call", () => {
    const a = generateRecoveryPhrase();
    const b = generateRecoveryPhrase();
    // With 136 words in the list, the probability of two identical
    // 12-word phrases is vanishingly small (~1 in 10^25).
    expect(a).not.toBe(b);
  });

  it("respects custom word count", () => {
    const phrase = generateRecoveryPhrase(6);
    expect(phrase.split(" ")).toHaveLength(6);
  });

  it("uses only lowercase alpha words", () => {
    const phrase = generateRecoveryPhrase();
    for (const word of phrase.split(" ")) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });

  it("generates phrases with reasonable entropy (no duplicates in short phrase)", () => {
    // A 12-word phrase from 136 words. Check that we get variety.
    const phrases = Array.from({ length: 20 }, () => generateRecoveryPhrase());
    const unique = new Set(phrases);
    expect(unique.size).toBe(20);
  });
});
