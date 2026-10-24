/**
 * Plan 11.2 (c) — the plugin gallery: the registry list, the consent
 * dialog (every capability unticked until the user ticks it), install,
 * permissions, uninstall, install from a file (unverified warning).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

vi.mock("../i18n", () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k) }));
vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const startPlugin = vi.fn(async () => ({}));
const stopPlugin = vi.fn(async () => undefined);
vi.mock("../plugins/runtime/manager", () => ({ startPlugin: (...a: unknown[]) => startPlugin(...(a as [])), stopPlugin: (...a: unknown[]) => stopPlugin(...(a as [])), clearPluginData: async () => undefined }));

const root = resolve(__dirname, "../..");
const registryText = readFileSync(join(root, "public/plugins/registry.json"), "utf8");
const bundleText = (file: string) => readFileSync(join(root, "public", file), "utf8");

beforeEach(async () => {
  startPlugin.mockClear();
  localStorage.clear();
  const { set } = await import("idb-keyval");
  await set("lumen.plugins.installed", []);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("plugins/registry.json")) return new Response(registryText);
      const m = /(plugins\/bundles\/.+)$/.exec(u);
      if (m) return new Response(bundleText(m[1]));
      return new Response("", { status: 404 });
    }),
  );
});

describe("PluginGallery", () => {
  it("renders null when closed and the registry when open", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container, rerender } = render(<PluginGallery open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    rerender(<PluginGallery open onClose={vi.fn()} />);
    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    await waitFor(() => expect(container.querySelectorAll("[data-plugin-row]").length).toBe(3));
    expect(container.textContent).toContain("Word stats");
  });

  it("installs with nothing granted until the user ticks it; the grants are saved and the plugin started", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(<PluginGallery open onClose={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-plugin-row="lumen.example.word-stats"] [data-testid="plugin-install"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-plugin-row="lumen.example.word-stats"] [data-testid="plugin-install"]')!);
    await waitFor(() => expect(container.querySelector("[data-testid='plugin-consent']")).not.toBeNull());
    const boxes = [...container.querySelectorAll<HTMLInputElement>("[data-capability]")];
    expect(boxes.map((b) => b.dataset.capability)).toEqual(["document:read", "commands", "panel", "settings"]);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(container.querySelector("[data-testid='plugin-consent-confirm']")!);
    await waitFor(() => expect(startPlugin).toHaveBeenCalledTimes(1));
    const { listInstalled } = await import("../plugins/runtime/installed");
    const [p] = await listInstalled();
    expect(p).toMatchObject({ id: "lumen.example.word-stats", grants: ["document:read", "commands"], enabled: true, source: "registry", trust: "pinned" });
    expect(localStorage.getItem("lumen.plugins.any")).toBe("1");
    await waitFor(() => expect(container.querySelector('[data-plugin-row="lumen.example.word-stats"]')?.getAttribute("data-installed")).toBe("true"));
  });

  it("uninstall removes it and the boot flag", async () => {
    const { installPlugin, listInstalled } = await import("../plugins/runtime/installed");
    const { parseBundle } = await import("../plugins/runtime/bundle");
    const b = parseBundle(bundleText("plugins/bundles/lumen.example.outline-1.0.0.lumenplugin.json"));
    await installPlugin(b, { sha256: "x", trust: "pinned", source: "registry", grants: ["commands"] });
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(<PluginGallery open onClose={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-plugin-row="lumen.example.outline"] [data-testid="plugin-uninstall"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-plugin-row="lumen.example.outline"] [data-testid="plugin-uninstall"]')!);
    await waitFor(async () => expect(await listInstalled()).toEqual([]));
    expect(localStorage.getItem("lumen.plugins.any")).toBeNull();
    expect(stopPlugin).toHaveBeenCalledWith("lumen.example.outline");
  });

  it("a file bundle nobody signed installs only after an 'unverified' warning", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(<PluginGallery open onClose={vi.fn()} />);
    await waitFor(() => expect(container.querySelectorAll("[data-plugin-row]").length).toBe(3));
    const input = container.querySelector<HTMLInputElement>("[data-testid='plugin-file-input']")!;
    const file = new File([bundleText("plugins/bundles/lumen.example.callout-1.0.0.lumenplugin.json")], "callout.lumenplugin.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(container.querySelector("[data-testid='plugin-consent']")).not.toBeNull());
    expect(container.querySelector("[data-testid='plugin-consent'] [role='alert']")?.textContent).toContain("plugins.trust.unverified");
  });

  it("a file that is not a plugin bundle is refused with a message", async () => {
    const { PluginGallery } = await import("../ui/PluginGallery");
    const { container } = render(<PluginGallery open onClose={vi.fn()} />);
    await waitFor(() => expect(container.querySelectorAll("[data-plugin-row]").length).toBe(3));
    const input = container.querySelector<HTMLInputElement>("[data-testid='plugin-file-input']")!;
    fireEvent.change(input, { target: { files: [new File(["export default 1"], "x.js")] } });
    await waitFor(() => expect(container.textContent).toContain("not a Lumen plugin bundle"));
    expect(container.querySelector("[data-testid='plugin-consent']")).toBeNull();
  });
});
