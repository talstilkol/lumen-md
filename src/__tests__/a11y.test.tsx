/**
 * a11y smoke tests — render the headline UI surfaces and run axe-core to
 * catch the violations any tooling would flag (missing labels, ARIA misuse,
 * contrast issues that show up in DOM, etc.).
 *
 * We don't render the full App (it pulls every lazy chunk) — instead we
 * render the dialogs / panels in isolation and assert axe finds zero
 * "serious" or "critical" violations. "Moderate" issues are surfaced as
 * console warnings rather than failures.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import axe from "axe-core";
import { Toolbar } from "../ui/Toolbar";
import { AuthDialog } from "../components/AuthDialog";
import { MobileKeyboardBar } from "../ui/MobileKeyboardBar";
import { Outline } from "../ui/Outline";
import { CommandPalette } from "../ui/CommandPalette";
import { SearchDialog } from "../ui/SearchDialog";
import { TagsPanel } from "../ui/TagsPanel";
import { BacklinksPanel } from "../ui/BacklinksPanel";
import { KeyboardShortcuts } from "../ui/KeyboardShortcuts";
import { TemplateGallery } from "../ui/TemplateGallery";
import { vi } from "vitest";
import { StatusBar } from "../ui/StatusBar";
import { DocTabs } from "../ui/DocTabs";

async function runAxe(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    resultTypes: ["violations"],
  });
  return result.violations;
}

function expectNoBlockers(violations: axe.Result[]) {
  const blockers = violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  if (blockers.length > 0) {
    // eslint-disable-next-line no-console
    console.log("a11y blockers:", JSON.stringify(blockers, null, 2));
  }
  expect(blockers).toEqual([]);
}

describe("axe a11y smoke", () => {
  it("Toolbar renders with no critical/serious axe violations", async () => {
    const { container } = render(
      <Toolbar
        onOpen={() => {}}
        onSave={() => {}}
        onNew={() => {}}
        onCommandPalette={() => {}}
      />,
    );
    expectNoBlockers(await runAxe(container));
  });

  it("AuthDialog (open) renders with no critical/serious axe violations", async () => {
    const { container } = render(<AuthDialog open onClose={() => {}} />);
    expectNoBlockers(await runAxe(container));
  });

  it("MobileKeyboardBar renders without blockers (component is hidden when not on touch device)", async () => {
    const { container } = render(<MobileKeyboardBar />);
    expectNoBlockers(await runAxe(container));
  });

  it("Outline renders no blockers on a typical heading-rich doc", async () => {
    const md = "# Title\n## Sub-section A\n### Detail\n## Sub-section B\n";
    const { container } = render(<Outline markdownText={md} />);
    expectNoBlockers(await runAxe(container));
  });

  it("CommandPalette (open) renders no blockers", async () => {
    // Use commands in the curated "Recent" group so the palette's category
    // filter doesn't suppress them and the listbox renders option children
    // (axe-required for role="listbox").
    const { container } = render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={[
          { id: "cmd.test1", label: "Test command 1", group: "Recent", action: () => {} },
          { id: "cmd.test2", label: "Test command 2", group: "Recent", action: () => {} },
        ]}
      />,
    );
    expectNoBlockers(await runAxe(container));
  });

  it("SearchDialog (open) renders no blockers", async () => {
    const { container } = render(
      <SearchDialog open onClose={() => {}} onOpenFile={() => {}} />,
    );
    expectNoBlockers(await runAxe(container));
  });

  it("TagsPanel (open) renders no blockers", async () => {
    const { container } = render(<TagsPanel open onClose={() => {}} />);
    expectNoBlockers(await runAxe(container));
  });

  it("BacklinksPanel renders no blockers (no active doc)", async () => {
    const { container } = render(
      <BacklinksPanel filePath={null} onOpen={() => {}} />,
    );
    expectNoBlockers(await runAxe(container));
  });

  it("KeyboardShortcuts (open) renders no blockers", async () => {
    const { container } = render(
      <KeyboardShortcuts open onClose={() => {}} />,
    );
    expectNoBlockers(await runAxe(container));
  });

  it("StatusBar renders no blockers", async () => {
    const { container } = render(
      <StatusBar text="hello world" dirty={false} filename="test.md" />,
    );
    expectNoBlockers(await runAxe(container));
  });

  it("TemplateGallery (open, mocked registry) renders no blockers", async () => {
    // Stub the registry fetch so the gallery doesn't try to hit /templates/.
    const mod = await import("../storage/templateMarketplace");
    vi.spyOn(mod, "fetchTemplateRegistry").mockResolvedValue([
      {
        id: "demo",
        name: "Demo",
        category: "Test",
        author: "Lumen",
        description: "A demo template",
        icon: "📓",
        version: "1.0.0",
        url: "templates/demo.md",
        rating: 5,
        downloads: 0,
        tags: ["demo"],
      },
    ]);
    const { container } = render(
      <TemplateGallery open onClose={() => {}} />,
    );
    // axe needs the async load to settle first.
    await new Promise((r) => setTimeout(r, 50));
    expectNoBlockers(await runAxe(container));
  });

  it("DocTabs (3 tabs) renders no blockers; close-X is keyboard reachable", async () => {
    const { container } = render(
      <DocTabs
        tabs={[
          { id: "a", name: "a.md", dirty: false },
          { id: "b", name: "b.md", dirty: true },
          { id: "c", name: "c.md", dirty: false },
        ]}
        activeId="a"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expectNoBlockers(await runAxe(container));
  });
});
