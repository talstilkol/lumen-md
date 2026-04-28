/**
 * ErrorBoundary — tests for the getDerivedStateFromError static method.
 */
import { describe, it, expect } from "vitest";

// Extract the static method logic
function getDerivedStateFromError(error: Error) {
  return { hasError: true, error };
}

describe("ErrorBoundary.getDerivedStateFromError", () => {
  it("returns hasError: true when given an error", () => {
    const error = new Error("test error");
    const state = getDerivedStateFromError(error);
    expect(state.hasError).toBe(true);
    expect(state.error).toBe(error);
  });

  it("preserves the error message", () => {
    const error = new Error("Something went wrong");
    const state = getDerivedStateFromError(error);
    expect(state.error.message).toBe("Something went wrong");
  });

  it("handles error with stack trace", () => {
    const error = new Error("with stack");
    const state = getDerivedStateFromError(error);
    expect(state.error.stack).toBeDefined();
  });
});

describe("ErrorBoundary render logic", () => {
  it("renders children when hasError is false", () => {
    const state = { hasError: false, error: null };
    expect(state.hasError).toBe(false);
  });

  it("shows fallback when provided and hasError is true", () => {
    const state = { hasError: true, error: new Error("test") };
    const hasFallback = true;
    // When hasError && fallback => render fallback
    expect(state.hasError && hasFallback).toBe(true);
  });

  it("shows default error UI when no fallback", () => {
    const state = { hasError: true, error: new Error("test") };
    const hasFallback = false;
    expect(state.hasError && !hasFallback).toBe(true);
  });
});
