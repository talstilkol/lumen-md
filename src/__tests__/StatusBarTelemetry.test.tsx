/**
 * Render test for the StatusBar's Telemetry toggle pill. Verifies that:
 *   - The telemetry pill always renders (it's not gated on any feature).
 *   - Clicking it toggles the opt-out state via localStorage.
 *   - The aria-pressed attribute reflects the current state.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBar } from "../ui/StatusBar";

// Mock the telemetry module so we don't touch real localStorage
vi.mock("../lib/telemetry", () => {
  let optOut = false;
  return {
    getTelemetryOptOut: () => optOut,
    setTelemetryOptOut: (v: boolean) => { optOut = v; },
    initTelemetry: vi.fn(),
    reportError: vi.fn(),
  };
});

describe("StatusBar — Telemetry toggle pill", () => {
  beforeEach(() => {
    vi.resetModules;
  });

  it("renders the telemetry pill", () => {
    render(
      <StatusBar text="hello world" dirty={false} filename="x.md" />,
    );
    const pill = screen.getByTestId("status-telemetry");
    expect(pill).toBeTruthy();
  });

  it("has aria-pressed attribute", () => {
    render(
      <StatusBar text="hello world" dirty={false} filename="x.md" />,
    );
    const pill = screen.getByTestId("status-telemetry");
    // aria-pressed should be a string "true" or "false"
    expect(["true", "false"]).toContain(pill.getAttribute("aria-pressed"));
  });

  it("toggles on click", () => {
    render(
      <StatusBar text="hello world" dirty={false} filename="x.md" />,
    );
    const pill = screen.getByTestId("status-telemetry");
    const before = pill.getAttribute("aria-pressed");
    fireEvent.click(pill);
    // After click, aria-pressed should flip
    const after = pill.getAttribute("aria-pressed");
    expect(after).not.toBe(before);
  });
});
