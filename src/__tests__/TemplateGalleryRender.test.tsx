/**
 * Render tests for the TemplateGallery dialog. We mock the registry
 * fetch + install paths so the test is hermetic — no OPFS, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// vi.mock is hoisted; the factory must self-contain its data.
vi.mock("../storage/templateMarketplace", () => {
  const REGISTRY = [
    {
      id: "daily-journal-pro",
      name: "Daily Journal Pro",
      category: "Journaling",
      author: "Lumen Team",
      description: "Mood, energy, gratitude.",
      icon: "📓",
      version: "1.0.0",
      url: "templates/daily-journal-pro.md",
      rating: 4.9,
      downloads: 0,
      tags: ["journal", "habits"],
    },
    {
      id: "weekly-review",
      name: "Weekly Review",
      category: "Reflection",
      author: "Lumen Team",
      description: "GTD weekly review.",
      icon: "🗓️",
      version: "1.0.0",
      url: "templates/weekly-review.md",
      rating: 4.8,
      downloads: 0,
      tags: ["gtd"],
    },
  ];
  return {
    fetchTemplateRegistry: vi.fn().mockResolvedValue(REGISTRY),
    installTemplate: vi.fn().mockResolvedValue({
      path: "templates/daily-journal-pro.md",
      bytes: 1234,
    }),
  };
});

vi.mock("../ui/AiToast", () => ({
  showAiToast: vi.fn(),
  AiToastContainer: () => null,
}));

import { TemplateGallery } from "../ui/TemplateGallery";
import { fetchTemplateRegistry, installTemplate } from "../storage/templateMarketplace";

describe("TemplateGallery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <TemplateGallery open={false} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("loads the registry on open and renders both rows", async () => {
    render(<TemplateGallery open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("Daily Journal Pro")).toBeTruthy();
    });
    expect(screen.getByText("Weekly Review")).toBeTruthy();
    expect(fetchTemplateRegistry).toHaveBeenCalledTimes(1);
  });

  it("filters by category chip", async () => {
    render(<TemplateGallery open onClose={() => {}} />);
    await waitFor(() => screen.getByText("Daily Journal Pro"));

    // The header (h3) and chip both contain "Journaling" — getAllByText
    // finds both; pick the chip via tagName to avoid the article header.
    const chip = screen
      .getAllByText("Journaling")
      .find((el) => el.tagName === "BUTTON");
    expect(chip).toBeTruthy();
    fireEvent.click(chip!);

    expect(screen.queryByText("Weekly Review")).toBeNull();
    expect(screen.getByText("Daily Journal Pro")).toBeTruthy();
  });

  it("Install button calls installTemplate with the right id", async () => {
    render(<TemplateGallery open onClose={() => {}} />);
    await waitFor(() => screen.getByText("Daily Journal Pro"));

    const installButtons = screen.getAllByRole("button", { name: /Install/i });
    // First template's Install button
    fireEvent.click(installButtons[0]);

    await waitFor(() => {
      expect(installTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "daily-journal-pro" }),
      );
    });
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(<TemplateGallery open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Close gallery/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
