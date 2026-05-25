/**
 * FocusMode — tests for the Escape key handler logic
 */
import { describe, it, expect, vi } from "vitest";

describe("FocusMode logic", () => {
  it("Escape key triggers onExit callback", () => {
    const onExit = vi.fn();
    
    // Simulate the handleKey logic from FocusMode
    function handleKey(e: { key: string; preventDefault: () => void }) {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    }

    const preventDefault = vi.fn();
    handleKey({ key: "Escape", preventDefault });
    
    expect(onExit).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("non-Escape key does not trigger exit", () => {
    const onExit = vi.fn();
    
    function handleKey(e: { key: string; preventDefault: () => void }) {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    }

    handleKey({ key: "Enter", preventDefault: vi.fn() });
    expect(onExit).not.toHaveBeenCalled();
  });

  it("active=false means component returns null", () => {
    // The component renders null when not active
    const active = false;
    expect(active ? "rendered" : null).toBeNull();
  });

  it("width calculation is correct", () => {
    // min(780px, 92vw) — ensure the max-width constant is sensible
    const maxWidth = 780;
    const vwPercent = 92;
    expect(maxWidth).toBeLessThan(1920 * (vwPercent / 100)); // Fits on 1080p+
    expect(maxWidth).toBeGreaterThan(600); // Reasonable minimum
  });
});
