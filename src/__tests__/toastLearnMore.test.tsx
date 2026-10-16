/**
 * "Learn more" CTA on error toasts (PRODUCT_IMPROVEMENT 2.4) — both
 * toast systems render the link only when a docs URL is supplied.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AiToastContainer, showAiToast } from "../ui/AiToast";
import { ToastContainer } from "../components/Toast";
import { useToastStore, toast } from "../store/useToastStore";

const URL = "https://docs.lumen-md.app/account/sign-in/";

describe("AiToast learn-more link", () => {
  it("renders a new-tab link when learnMoreUrl is given", () => {
    render(<AiToastContainer />);
    act(() => showAiToast("Sign-in failed", "error", { learnMoreUrl: URL }));
    const a = screen.getByRole("link", { name: "Learn more" });
    expect(a.getAttribute("href")).toBe(URL);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("renders no link without one", () => {
    const { container } = render(<AiToastContainer />);
    act(() => showAiToast("Plain error", "error"));
    expect(container.textContent).toContain("Plain error");
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("Toast store learn-more link", () => {
  beforeEach(() => useToastStore.getState().clear());

  it("toast.error forwards the docs URL to the card", () => {
    render(<ToastContainer />);
    act(() => {
      toast.error("SSO sign-in failed", "Start again.", URL);
    });
    expect(useToastStore.getState().toasts[0].learnMoreUrl).toBe(URL);
    expect(screen.getByRole("link", { name: "Learn more" }).getAttribute("href")).toBe(URL);
    expect(screen.getByRole("alert").textContent).toContain("Start again.");
  });
});

describe("toast action button", () => {
  it("runs the action and dismisses the toast", async () => {
    const { fireEvent } = await import("@testing-library/react");
    useToastStore.getState().clear();
    let ran = 0;
    render(<ToastContainer />);
    act(() => {
      useToastStore.getState().push({ kind: "warning", title: "Room is empty", ttlMs: 0, action: { label: "Share", run: () => ran++ } });
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(ran).toBe(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
