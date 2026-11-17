/**
 * Review 12, L2: review 11 M5 marks an installed plugin `disabled` when its
 * registry takes the version down, but nothing read the flag: the same
 * version could be started again (a reinstall from a cached page, a dev
 * load with the same id and version). startPlugin, the one way a plugin
 * runs, now refuses a disabled version before any worker exists; another
 * version of the same plugin is not affected.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { del as idbDel, set as idbSet } from "idb-keyval";
import { PluginDisabledError, startPlugin } from "../plugins/runtime/manager";
import type { InstalledRecord } from "../plugins/install";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));
vi.mock("../plugins/runtime/PluginPanel", () => ({ ensurePanelHost: vi.fn() }));

const ID = "sample.word-stamp";
const record: InstalledRecord = { id: ID, version: "1.0.0", registry: "https://plugins.example.org/registry", sha256: "a".repeat(64), manifestSha256: "b".repeat(64), grants: [], installedAt: 1, disabled: { at: 2, reason: "delisted", rules: ["exfiltration"] } };
const manifest = (version: string) => ({ id: ID, name: "Word stamp", version, main: "main.js", capabilities: [] }) as never;

beforeEach(async () => {
  await idbDel("lumen.plugins.installed");
});

describe("a disabled plugin is never started (review 12, L2)", () => {
  it("startPlugin refuses the disabled version before it makes a worker; other versions still start", async () => {
    await idbSet("lumen.plugins.installed", { [ID]: record });
    const createWorker = vi.fn(() => {
      throw new Error("worker made");
    });
    await expect(startPlugin({ manifest: manifest("1.0.0"), code: "", grants: new Set(), createWorker })).rejects.toBeInstanceOf(PluginDisabledError);
    await expect(startPlugin({ manifest: manifest("1.0.0"), code: "", grants: new Set(), createWorker })).rejects.toThrow(/taken down by its registry \(exfiltration\)/);
    expect(createWorker).not.toHaveBeenCalled();
    // Another version, or a record that is not disabled, gets past the check (to the worker).
    await expect(startPlugin({ manifest: manifest("1.0.1"), code: "", grants: new Set(), createWorker })).rejects.toThrow(/worker made/);
    const { disabled: _d, ...live } = record;
    await idbSet("lumen.plugins.installed", { [ID]: live });
    await expect(startPlugin({ manifest: manifest("1.0.0"), code: "", grants: new Set(), createWorker })).rejects.toThrow(/worker made/);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });
});
