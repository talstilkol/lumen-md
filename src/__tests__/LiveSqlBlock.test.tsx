/**
 * Smoke test for the Live SQL block. Verifies controls and source render
 * without loading sql.js (the SQLite WASM runtime only loads on Run, which
 * needs a real browser + network — not exercised here).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LiveSqlBlock from "../plugins/LiveSqlBlock";

afterEach(cleanup);

describe("LiveSqlBlock", () => {
  it("renders Run control and the idle prompt without loading sql.js", () => {
    render(<LiveSqlBlock source={"SELECT 1;"} />);
    expect(screen.getByRole("button", { name: /run sql/i })).toBeTruthy();
    expect(screen.getByText(/Click Run to execute this SQL block/i)).toBeTruthy();
    expect(screen.getByText(/SQL: Not run/i)).toBeTruthy();
  });

  it("shows the source when the Source toggle is on", () => {
    render(<LiveSqlBlock source={"SELECT 42 AS answer;"} />);
    fireEvent.click(screen.getByRole("button", { name: /^source$/i }));
    expect(screen.getByText(/SELECT 42 AS answer/)).toBeTruthy();
  });
});
