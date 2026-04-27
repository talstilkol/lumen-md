/**
 * Tests for the local LLM availability check. The actual WebGPU + model
 * download paths can't be exercised in jsdom, but `localLlmAvailable()`
 * gates the rest of the code, so we pin its branches.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { localLlmAvailable, onLocalLlmProgress, unloadLocalLlm } from "../ai/localLlm";

describe("localLlmAvailable", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    unloadLocalLlm();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  it("returns unavailable when WebGPU is missing", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    const status = localLlmAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/WebGPU/);
  });

  it("returns available when WebGPU is present", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { gpu: {} },
      configurable: true,
    });
    expect(localLlmAvailable().available).toBe(true);
  });

  it("onLocalLlmProgress returns an unsubscribe function", () => {
    const off = onLocalLlmProgress(() => {});
    expect(typeof off).toBe("function");
    off();
  });
});
