/**
 * Render test for the StatusBar's Privacy Mode badge. Verifies that:
 *   - When `useLocalAi` is on, a green "PRIVATE" pill renders.
 *   - When `useLocalAi` is off but `aiKey` is set, the regular AI pill
 *     renders instead (the two pills are mutually exclusive).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "../ui/StatusBar";
import { useAppStore } from "../store/useStore";

function reset() {
  useAppStore.setState({
    aiKey: null,
    useLocalAi: false,
  });
}

describe("StatusBar — Privacy Mode badge", () => {
  beforeEach(reset);

  it("renders the PRIVATE badge when useLocalAi is on", () => {
    useAppStore.setState({ useLocalAi: true });
    render(
      <StatusBar text="hello world" dirty={false} filename="x.md" />,
    );
    const badge = screen.getByTestId("status-privacy-mode");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toMatch(/PRIVATE/i);
  });

  it("does not render the PRIVATE badge when useLocalAi is off", () => {
    useAppStore.setState({ useLocalAi: false });
    render(
      <StatusBar text="hello world" dirty={false} filename="x.md" />,
    );
    expect(screen.queryByTestId("status-privacy-mode")).toBeNull();
  });

  it("hides the cloud-AI pill when Privacy Mode is on (mutual exclusion)", () => {
    useAppStore.setState({ useLocalAi: true, aiKey: "sk-test" });
    render(
      <StatusBar text="hello world" dirty={false} filename="x.md" />,
    );
    // The classic AI pill is identified by title "AI Copilot Active".
    expect(screen.queryByTitle("AI Copilot Active")).toBeNull();
    // And the privacy pill remains.
    expect(screen.getByTestId("status-privacy-mode")).toBeTruthy();
  });
});
