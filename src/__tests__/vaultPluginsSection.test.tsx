/**
 * W13.S2 (F16): "Plugins found in this vault" in the plugin gallery. Found
 * plugins are listed and never run; each goes through the install screen,
 * whose Install approves exactly these bytes with the permissions shown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { clear } from "idb-keyval";
import { VaultPluginsSection, type VaultPluginDeps } from "../plugins/runtime/VaultPluginsSection";
import { vaultApprovals } from "../plugins/vaultPlugins";
import type { ScanResult } from "../plugins/runtime/scan";

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, id: "lumen.example.word-count", name: "Word Count", version: "1.0.0", author: "A", license: "MIT", description: "Counts", main: "main.js", capabilities: [{ id: "document:read", reason: "to count" }], ...over });

function fs(files: Record<string, string>) {
  return { paths: async () => Object.keys(files), read: async (p: string) => files[p] };
}

const passed = { passed: true, grade: "A", score: 95, findings: [], sha256: "x" } as unknown as ScanResult;

function deps(files: Record<string, string>, start = vi.fn(async () => ({}))): VaultPluginDeps & { start: typeof start } {
  return { ...fs(files), scan: vi.fn(async () => passed), start };
}

beforeEach(async () => {
  await clear();
});

describe("plugins found in this vault", () => {
  it("lists what was found, says nothing runs, and starts nothing on its own", async () => {
    const d = deps({ ".lumen/plugins/wc/manifest.json": manifest(), ".lumen/plugins/wc/main.js": "export default 1", ".obsidian/plugins/half/main.js": "x" });
    render(<VaultPluginsSection deps={d} />);
    const items = await screen.findAllByTestId("vault-plugin");
    expect(items).toHaveLength(1); // a folder without manifest.json is not a plugin
    expect(items[0].dataset.verdict).toBe("needs-permission");
    expect(items[0].textContent).toMatch(/not installed: it does not run/);
    expect(screen.getByText(/Nothing here runs/)).toBeTruthy();
    expect(d.start).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Plugins found in this vault" })).toBeTruthy();
  });

  it("Review and install opens the install screen; Cancel approves nothing; Install approves these bytes with the shown permissions and starts it in the sandbox", async () => {
    const d = deps({ ".lumen/plugins/wc/manifest.json": manifest(), ".lumen/plugins/wc/main.js": "export default 1" });
    render(<VaultPluginsSection deps={d} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review and install Word Count" }));
    let dialog = await screen.findByTestId("plugin-install-dialog");
    expect(within(dialog).getAllByTestId("install-capability").map((li) => li.dataset.capability)).toEqual(["document:read"]);
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByTestId("plugin-install-dialog")).toBeNull());
    expect(await vaultApprovals()).toEqual({});
    expect(d.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Review and install Word Count" }));
    dialog = await screen.findByTestId("plugin-install-dialog");
    const buttons = within(dialog).getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]); // Install
    await waitFor(() => expect(d.start).toHaveBeenCalledTimes(1));
    const call = d.start.mock.calls[0] as unknown as [{ grants: Set<string>; code: string }];
    expect([...call[0].grants]).toEqual(["document:read"]);
    expect(call[0].code).toBe("export default 1");
    const a = await vaultApprovals();
    expect(Object.keys(a)).toEqual([".lumen/plugins/wc"]);
    await waitFor(() => expect(screen.getByTestId("vault-plugin").dataset.verdict).toBe("approved"));
  });

  it("a plugin whose files changed after approval needs the screen again; withdrawing the approval works", async () => {
    const files = { ".lumen/plugins/wc/manifest.json": manifest(), ".lumen/plugins/wc/main.js": "v1" };
    const d = deps(files);
    const { unmount } = render(<VaultPluginsSection deps={d} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review and install Word Count" }));
    const dialog = await screen.findByTestId("plugin-install-dialog");
    const b = within(dialog).getAllByRole("button");
    fireEvent.click(b[b.length - 1]);
    await waitFor(() => expect(d.start).toHaveBeenCalled());
    unmount();
    files[".lumen/plugins/wc/main.js"] = "v2 — a sync brought new code";
    render(<VaultPluginsSection deps={deps(files)} />);
    const item = await screen.findByTestId("vault-plugin");
    expect(item.dataset.verdict).toBe("changed");
    expect(within(item).getByRole("button", { name: "Review and install Word Count" })).toBeTruthy();
    fireEvent.click(within(item).getByRole("button", { name: "Withdraw approval" }));
    await waitFor(() => expect(screen.getByTestId("vault-plugin").dataset.verdict).toBe("needs-permission"));
    expect(await vaultApprovals()).toEqual({});
  });

  it("a folder whose manifest is not a Lumen plugin cannot be installed", async () => {
    render(<VaultPluginsSection deps={deps({ ".obsidian/plugins/ob/manifest.json": JSON.stringify({ id: "ob", name: "Obsidian thing" }), ".obsidian/plugins/ob/main.js": "x" })} />);
    const item = await screen.findByTestId("vault-plugin");
    expect(item.textContent).toMatch(/Not a Lumen plugin/);
    expect(within(item).queryByRole("button")).toBeNull();
  });

  it("an empty vault says so", async () => {
    render(<VaultPluginsSection deps={deps({})} />);
    expect((await screen.findByTestId("vault-plugins-none")).textContent).toBe("No plugin folders in this vault.");
  });
});
