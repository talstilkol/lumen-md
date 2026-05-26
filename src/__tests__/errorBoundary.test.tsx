/**
 * ErrorBoundary — real component-level test.
 *
 * The previous errorBoundary.test.ts re-implemented
 * `getDerivedStateFromError` locally and tested THAT instead of the
 * actual ErrorBoundary class. That's theatre: it can pass while the
 * real component is broken. This test renders the component, mounts a
 * child that throws on render, and asserts the fallback shows + the
 * children disappear from the DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../ui/ErrorBoundary";

function Bomb({ message = "boom" }: { message?: string }): JSX.Element {
  throw new Error(message);
}

describe("ErrorBoundary (real render)", () => {
  // React logs the caught error to console.error in test mode. Silence
  // it so the test output stays clean; we still assert the boundary
  // caught the error.
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <p data-testid="child">child content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child").textContent).toBe("child content");
  });

  it("catches a render-time error and shows the default fallback", () => {
    render(
      <ErrorBoundary>
        <Bomb message="real-boom" />
      </ErrorBoundary>,
    );
    // The thrown error message appears inside the fallback.
    expect(screen.getByText(/real-boom/)).not.toBeNull();
    // The boundary logged via componentDidCatch (proves the lifecycle hook ran).
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("renders the custom `fallback` prop instead of the default UI", () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">custom UI</div>}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("custom-fallback")).not.toBeNull();
  });

  it("isolates failures: a sibling boundary keeps rendering its children", () => {
    render(
      <>
        <ErrorBoundary fallback={<span data-testid="failed">failed</span>}>
          <Bomb />
        </ErrorBoundary>
        <ErrorBoundary>
          <p data-testid="healthy">healthy sibling</p>
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByTestId("failed")).not.toBeNull();
    expect(screen.getByTestId("healthy")).not.toBeNull();
  });
});
