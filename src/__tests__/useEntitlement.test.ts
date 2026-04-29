import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("useEntitlement store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("starts in loading state with FREE_CAPS", async () => {
    const { useEntitlement } = await import("../billing/useEntitlement");
    const state = useEntitlement.getState();
    expect(state.loading).toBe(true);
    expect(state.entitlement).toBeNull();
  });

  it("refresh() resolves to FREE_CAPS when no dev tier set", async () => {
    const { useEntitlement } = await import("../billing/useEntitlement");
    await useEntitlement.getState().refresh();
    const state = useEntitlement.getState();
    expect(state.loading).toBe(false);
    expect(state.entitlement).toBeNull();
    expect(state.capabilities.aiMonthlyPrompts).toBe(100);
  });

  it("refresh() reads 'pro' from localStorage dev shim", async () => {
    localStorage.setItem("lumen.dev.tier", "pro");
    const { useEntitlement } = await import("../billing/useEntitlement");
    await useEntitlement.getState().refresh();
    const state = useEntitlement.getState();
    expect(state.entitlement?.tier).toBe("pro");
    expect(state.capabilities.smartSearch).toBe(true);
    expect(state.capabilities.aiMonthlyPrompts).toBe(1000);
  });

  it("refresh() reads 'team' from localStorage dev shim", async () => {
    localStorage.setItem("lumen.dev.tier", "team");
    const { useEntitlement } = await import("../billing/useEntitlement");
    await useEntitlement.getState().refresh();
    const state = useEntitlement.getState();
    expect(state.entitlement?.tier).toBe("team");
    expect(state.capabilities.auditLog).toBe(true);
    expect(state.capabilities.workspaceSharing).toBe(true);
  });

  it("refresh() ignores invalid tier values in localStorage", async () => {
    localStorage.setItem("lumen.dev.tier", "enterprise");
    const { useEntitlement } = await import("../billing/useEntitlement");
    await useEntitlement.getState().refresh();
    const state = useEntitlement.getState();
    // 'enterprise' is not a valid tier → should fall back to FREE_CAPS
    expect(state.entitlement).toBeNull();
    expect(state.capabilities.auditLog).toBe(false);
  });

  it("setLocal() immediately updates capabilities to pro", async () => {
    const { useEntitlement } = await import("../billing/useEntitlement");
    useEntitlement.getState().setLocal("pro");
    const state = useEntitlement.getState();
    expect(state.entitlement?.tier).toBe("pro");
    expect(state.capabilities.smartSearch).toBe(true);
    expect(state.loading).toBe(false);
  });

  it("setLocal() immediately updates capabilities to team", async () => {
    const { useEntitlement } = await import("../billing/useEntitlement");
    useEntitlement.getState().setLocal("team");
    const state = useEntitlement.getState();
    expect(state.capabilities.workspaceSharing).toBe(true);
  });

  it("setLocal() persists tier to localStorage", async () => {
    const { useEntitlement } = await import("../billing/useEntitlement");
    useEntitlement.getState().setLocal("pro");
    expect(localStorage.getItem("lumen.dev.tier")).toBe("pro");
  });
});

describe("useCapabilities via store state", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("store.capabilities is FREE_CAPS by default", async () => {
    const { useEntitlement } = await import("../billing/useEntitlement");
    const caps = useEntitlement.getState().capabilities;
    expect(caps.smartSearch).toBe(false);
    expect(caps.aiMonthlyPrompts).toBe(100);
  });
});
