/**
 * Unit tests for the plugin system.
 *
 * Run with: npx vitest run
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerPlugin, unregisterPlugin, getPluginCommands, emitHook, listPlugins } from "../plugins/pluginSystem";

describe("Plugin System", () => {
  const testPlugin = {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    commands: [
      { id: "test.hello", label: "Hello", action: () => {} },
    ],
    onActivate: () => {},
    onDeactivate: () => {},
  };

  beforeEach(() => {
    // Unregister if already registered from a previous test
    try { unregisterPlugin("test-plugin"); } catch { /* ok */ }
  });

  it("registers a plugin", () => {
    registerPlugin(testPlugin);
    const list = listPlugins();
    expect(list.some((p) => p.id === "test-plugin")).toBe(true);
  });

  it("adds plugin commands to the palette", () => {
    registerPlugin(testPlugin);
    const cmds = getPluginCommands();
    expect(cmds.some((c) => c.id === "test.hello")).toBe(true);
  });

  it("unregisters a plugin", () => {
    registerPlugin(testPlugin);
    unregisterPlugin("test-plugin");
    const list = listPlugins();
    expect(list.some((p) => p.id === "test-plugin")).toBe(false);
  });

  it("removes commands after unregistration", () => {
    registerPlugin(testPlugin);
    unregisterPlugin("test-plugin");
    const cmds = getPluginCommands();
    expect(cmds.some((c) => c.id === "test.hello")).toBe(false);
  });
});
