/**
 * Smoke test for the Live Python block. Verifies the component renders its
 * controls and source without loading Pyodide (the ~10MB WASM runtime only
 * loads on Run, which needs a real browser + network — not exercised here).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LivePyBlock from "../plugins/LivePyBlock";

afterEach(cleanup);

describe("LivePyBlock", () => {
  it("renders Run control and the idle prompt without loading Pyodide", () => {
    render(<LivePyBlock source={'print("hi")'} />);
    expect(screen.getByRole("button", { name: /run python/i })).toBeTruthy();
    expect(screen.getByText(/Click Run to execute this Python block/i)).toBeTruthy();
    expect(screen.getByText(/Python: Not run/i)).toBeTruthy();
  });

  it("shows the source when the Source toggle is on", () => {
    render(<LivePyBlock source={"x = 41 + 1"} meta="height=120" />);
    const toggle = screen.getByRole("button", { name: /^source$/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/x = 41 \+ 1/)).toBeTruthy();
  });
});
