/**
 * Render tests for the StatusBar grammar-check toggle pill.
 *
 * The pill mirrors the Privacy Mode pattern but is bidirectional:
 *   - When grammarCheck is OFF: dim Grammar text, click → flips ON.
 *   - When grammarCheck is ON: bright Grammar text, click → flips OFF.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBar } from "../ui/StatusBar";
import { useAppStore } from "../store/useStore";

function reset() {
  useAppStore.setState({
    aiKey: null,
    useLocalAi: false,
    grammarCheck: false,
  });
}

describe("StatusBar — grammar toggle", () => {
  beforeEach(reset);

  it("renders the grammar pill at all times (default OFF)", () => {
    render(<StatusBar text="hello" dirty={false} filename="x.md" />);
    const pill = screen.getByTestId("status-grammar");
    expect(pill).toBeTruthy();
    expect(pill.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking the pill flips the store flag", () => {
    render(<StatusBar text="hello" dirty={false} filename="x.md" />);
    const pill = screen.getByTestId("status-grammar");
    expect(useAppStore.getState().grammarCheck).toBe(false);
    fireEvent.click(pill);
    expect(useAppStore.getState().grammarCheck).toBe(true);
    fireEvent.click(pill);
    expect(useAppStore.getState().grammarCheck).toBe(false);
  });

  it("aria-pressed reflects the active state for assistive tech", () => {
    useAppStore.setState({ grammarCheck: true });
    render(<StatusBar text="hello" dirty={false} filename="x.md" />);
    const pill = screen.getByTestId("status-grammar");
    expect(pill.getAttribute("aria-pressed")).toBe("true");
  });

  it("tooltip text changes with state", () => {
    // OFF
    render(<StatusBar text="hello" dirty={false} filename="x.md" />);
    expect(
      screen.getByTestId("status-grammar").getAttribute("title"),
    ).toMatch(/OFF/);
  });
});
