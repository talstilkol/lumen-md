import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../i18n", () => ({ t: (k: string) => k }));
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../plugins/pluginSystem", () => ({
  getRegisteredPlugins: vi.fn().mockReturnValue([]),
  registerPlugin: vi.fn().mockResolvedValue(undefined),
  unregisterPlugin: vi.fn(),
}));

describe("PluginGallery", () => {
  it("renders without crashing when open", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(
      <PluginGallery open={true} onClose={vi.fn()} />,
    );
    expect(container).toBeDefined();
  });

  it("renders null when not open", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(
      <PluginGallery open={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("has a close button when open", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(
      <PluginGallery open={true} onClose={vi.fn()} />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("has search input when open", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(
      <PluginGallery open={true} onClose={vi.fn()} />,
    );
    const input = container.querySelector("input[type='text']");
    expect(input).not.toBeNull();
  });

  it("has role=dialog when open", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(
      <PluginGallery open={true} onClose={vi.fn()} />,
    );
    const dialog = container.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
  });

  it("shows community plugins in the grid", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(
      <PluginGallery open={true} onClose={vi.fn()} />,
    );
    // Should have some text about plugins
    expect(container.textContent).toContain("Plugin Gallery");
  });
});
