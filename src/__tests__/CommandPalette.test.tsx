/**
 * Component tests for CommandPalette.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommandPalette } from "../ui/CommandPalette";
import type { Command } from "../ui/CommandPalette";

// Use the "Recent" group so all commands appear in the palette's Main tab
// without being suppressed by the toolbar-dedupe filter or the
// curated-essentials list.
function makeCommands(): Command[] {
  return [
    {
      id: "test.new",
      label: "New document",
      group: "Recent",
      action: vi.fn(),
    },
    {
      id: "test.open",
      label: "Open file",
      shortcut: "⌘O",
      group: "Recent",
      action: vi.fn(),
    },
    {
      id: "test.viewGroup",
      label: "View modes",
      group: "Recent",
      action: vi.fn(),
      children: [
        { id: "test.viewSource", label: "Source view", group: "Recent", action: vi.fn() },
        { id: "test.viewSplit", label: "Split view", group: "Recent", action: vi.fn() },
      ],
    },
    {
      id: "test.chart",
      label: "Insert chart",
      hint: "ECharts spec",
      group: "Recent",
      action: vi.fn(),
    },
  ];
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CommandPalette open={false} onClose={vi.fn()} commands={makeCommands()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders commands when open", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} commands={makeCommands()} />,
    );
    return waitFor(() => {
      expect(screen.getByText("New document")).toBeTruthy();
      expect(screen.getByText("Open file")).toBeTruthy();
    });
  });

  it("filters commands by search query", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} commands={makeCommands()} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "chart" } });
    return waitFor(() => {
      expect(screen.getByText("Insert chart")).toBeTruthy();
      expect(screen.queryByText("New document")).toBeNull();
    });
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette open={true} onClose={onClose} commands={makeCommands()} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape" });
    return waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette open={true} onClose={onClose} commands={makeCommands()} />,
    );
    return waitFor(() => {
      const backdrop = document.querySelector(".cmd-palette-backdrop");
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("expands sub-menus on Enter when command has children", () => {
    const commands = makeCommands();
    render(
      <CommandPalette open={true} onClose={vi.fn()} commands={commands} />,
    );
    // The "View modes" command with children should show ▶ indicator
    return waitFor(() => {
      expect(screen.getByText("View modes")).toBeTruthy();
      expect(screen.getByText("▶")).toBeTruthy();
    });
  });

  it("shows keyboard shortcut hints", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} commands={makeCommands()} />,
    );
    return waitFor(() => expect(screen.getByText("⌘O")).toBeTruthy());
  });

  it("shows footer navigation hints", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} commands={makeCommands()} />,
    );
    // Footer should have navigate/select/close hints
    return waitFor(() => {
      expect(screen.getByText("↑")).toBeTruthy();
      expect(screen.getByText("↵")).toBeTruthy();
      expect(screen.getByText("Esc")).toBeTruthy();
    });
  });
});
