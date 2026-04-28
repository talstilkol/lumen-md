/**
 * Render tests for the DocTabs strip — verifies the close-X is reachable,
 * keyboard-actionable, and that the drag-reorder handler is invoked with
 * the correct from/to indexes.
 *
 * jsdom doesn't simulate the dataTransfer object across drag events
 * faithfully, so for reorder we exercise the contract by firing a
 * `drop` with a manually-constructed dataTransfer-like.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocTabs } from "../ui/DocTabs";

const TABS = [
  { id: "a.md", name: "a.md", dirty: false },
  { id: "b.md", name: "b.md", dirty: true },
  { id: "c.md", name: "c.md", dirty: false },
];

describe("DocTabs", () => {
  it("renders nothing when only one tab is open", () => {
    const { container } = render(
      <DocTabs
        tabs={[TABS[0]]}
        activeId="a.md"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one tab per item with the close button labelled", () => {
    render(
      <DocTabs
        tabs={TABS}
        activeId="a.md"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    // a.md, b.md, c.md → three close buttons
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    expect(closeButtons).toHaveLength(3);
  });

  it("clicking the X fires onClose with the tab id (not select)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <DocTabs
        tabs={TABS}
        activeId="a.md"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledWith("b.md");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking the tab body fires onSelect", () => {
    const onSelect = vi.fn();
    render(
      <DocTabs
        tabs={TABS}
        activeId="a.md"
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /b\.md/i }));
    expect(onSelect).toHaveBeenCalledWith("b.md");
  });

  it("middle-click closes the tab (browser convention)", () => {
    const onClose = vi.fn();
    render(
      <DocTabs
        tabs={TABS}
        activeId="a.md"
        onSelect={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: /c\.md/i }), {
      button: 1,
    });
    expect(onClose).toHaveBeenCalledWith("c.md");
  });

  it("marks the active tab with aria-current=page", () => {
    render(
      <DocTabs
        tabs={TABS}
        activeId="b.md"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    const active = screen.getAllByRole("button").find(
      (b) => b.getAttribute("aria-current") === "page",
    );
    expect(active).toBeTruthy();
    expect(active!.textContent).toMatch(/b\.md/);
  });

  it("renders a leading dirty marker for dirty tabs", () => {
    render(
      <DocTabs
        tabs={TABS}
        activeId="a.md"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    // b.md is dirty → leading bullet. getByText throws if not found.
    const dirtyLabel = screen.getByText(/●\s+b\.md/);
    expect(dirtyLabel.textContent).toMatch(/b\.md/);
  });

  it("invokes onReorder with (from, to) on a synthetic drop event", () => {
    const onReorder = vi.fn();
    render(
      <DocTabs
        tabs={TABS}
        activeId="a.md"
        onSelect={() => {}}
        onClose={() => {}}
        onReorder={onReorder}
      />,
    );
    const tabs = screen.getAllByRole("button").filter(b => !b.getAttribute("aria-label")?.match(/close/i));
    // Start dragging tab 0 (a.md), drop on tab 2 (c.md). React's synthetic
    // dataTransfer doesn't actually move anything in jsdom — we set the
    // source via dragstart so the component's internal `dragSrc` flips.
    fireEvent.dragStart(tabs[0], {
      dataTransfer: {
        setData: () => {},
        effectAllowed: "move",
      },
    });
    fireEvent.dragOver(tabs[2], {
      dataTransfer: { dropEffect: "move" },
    });
    fireEvent.drop(tabs[2], {
      dataTransfer: {},
    });
    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });

  it("does not invoke onReorder when the user drops on the source tab", () => {
    const onReorder = vi.fn();
    render(
      <DocTabs
        tabs={TABS}
        activeId="a.md"
        onSelect={() => {}}
        onClose={() => {}}
        onReorder={onReorder}
      />,
    );
    const tabs = screen.getAllByRole("button").filter(b => !b.getAttribute("aria-label")?.match(/close/i));
    fireEvent.dragStart(tabs[1], {
      dataTransfer: { setData: () => {}, effectAllowed: "move" },
    });
    fireEvent.drop(tabs[1], { dataTransfer: {} });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
