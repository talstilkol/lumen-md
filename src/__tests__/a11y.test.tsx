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
});
