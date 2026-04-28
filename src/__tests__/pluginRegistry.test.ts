/**
 * Plugin system — tests for registration/deregistration lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface LumenPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  activate: (api: unknown) => void;
}

// Simulate the plugin registry
let plugins: Map<string, LumenPlugin>;

function registerPlugin(plugin: LumenPlugin): boolean {
  if (plugins.has(plugin.id)) return false;
  plugins.set(plugin.id, plugin);
  return true;
}

function unregisterPlugin(id: string): boolean {
  return plugins.delete(id);
}

function getRegisteredPlugins(): LumenPlugin[] {
  return Array.from(plugins.values());
}

beforeEach(() => {
  plugins = new Map();
});

describe("registerPlugin", () => {
  it("registers a new plugin", () => {
    const plugin: LumenPlugin = {
      id: "test.plugin",
      name: "Test Plugin",
      version: "1.0.0",
      activate: vi.fn(),
    };
    expect(registerPlugin(plugin)).toBe(true);
    expect(getRegisteredPlugins()).toHaveLength(1);
  });

  it("rejects duplicate plugin IDs", () => {
    const plugin: LumenPlugin = {
      id: "test.plugin",
      name: "Test",
      version: "1.0.0",
      activate: vi.fn(),
    };
    registerPlugin(plugin);
    expect(registerPlugin(plugin)).toBe(false);
    expect(getRegisteredPlugins()).toHaveLength(1);
  });

  it("registers multiple different plugins", () => {
    registerPlugin({ id: "a", name: "A", version: "1.0.0", activate: vi.fn() });
    registerPlugin({ id: "b", name: "B", version: "1.0.0", activate: vi.fn() });
    registerPlugin({ id: "c", name: "C", version: "1.0.0", activate: vi.fn() });
    expect(getRegisteredPlugins()).toHaveLength(3);
  });
});

describe("unregisterPlugin", () => {
  it("removes a registered plugin", () => {
    registerPlugin({ id: "test", name: "Test", version: "1.0.0", activate: vi.fn() });
    expect(unregisterPlugin("test")).toBe(true);
    expect(getRegisteredPlugins()).toHaveLength(0);
  });

  it("returns false for non-existent plugin", () => {
    expect(unregisterPlugin("nonexistent")).toBe(false);
  });
});

describe("getRegisteredPlugins", () => {
  it("returns empty array when no plugins", () => {
    expect(getRegisteredPlugins()).toEqual([]);
  });

  it("preserves plugin metadata", () => {
    registerPlugin({
      id: "test",
      name: "My Plugin",
      version: "2.0.0",
      description: "A test plugin",
      author: "Tester",
      activate: vi.fn(),
    });
    const [plugin] = getRegisteredPlugins();
    expect(plugin.name).toBe("My Plugin");
    expect(plugin.version).toBe("2.0.0");
    expect(plugin.description).toBe("A test plugin");
    expect(plugin.author).toBe("Tester");
  });
});
