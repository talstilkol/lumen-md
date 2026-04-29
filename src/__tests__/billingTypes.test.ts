import { describe, it, expect } from "vitest";
import {
  capabilitiesFor,
  FREE_CAPS,
  PRO_CAPS,
  TEAM_CAPS,
} from "../billing/types";
import type { Entitlement } from "../billing/types";

describe("capabilitiesFor", () => {
  it("returns FREE_CAPS when entitlement is null", () => {
    expect(capabilitiesFor(null)).toEqual(FREE_CAPS);
  });

  it("returns FREE_CAPS for a canceled subscription", () => {
    const ent: Entitlement = { tier: "pro", status: "canceled" };
    expect(capabilitiesFor(ent)).toEqual(FREE_CAPS);
  });

  it("returns FREE_CAPS for a past_due subscription", () => {
    const ent: Entitlement = { tier: "pro", status: "past_due" };
    expect(capabilitiesFor(ent)).toEqual(FREE_CAPS);
  });

  it("returns FREE_CAPS for status=none", () => {
    const ent: Entitlement = { tier: "pro", status: "none" };
    expect(capabilitiesFor(ent)).toEqual(FREE_CAPS);
  });

  it("returns PRO_CAPS for active pro subscription", () => {
    const ent: Entitlement = { tier: "pro", status: "active" };
    expect(capabilitiesFor(ent)).toEqual(PRO_CAPS);
  });

  it("returns PRO_CAPS for trialing pro subscription", () => {
    const ent: Entitlement = { tier: "pro", status: "trialing" };
    expect(capabilitiesFor(ent)).toEqual(PRO_CAPS);
  });

  it("returns TEAM_CAPS for active team subscription", () => {
    const ent: Entitlement = { tier: "team", status: "active" };
    expect(capabilitiesFor(ent)).toEqual(TEAM_CAPS);
  });

  it("returns FREE_CAPS for active free tier", () => {
    const ent: Entitlement = { tier: "free", status: "active" };
    expect(capabilitiesFor(ent)).toEqual(FREE_CAPS);
  });
});

describe("FREE_CAPS", () => {
  it("has 100 monthly AI prompts", () => {
    expect(FREE_CAPS.aiMonthlyPrompts).toBe(100);
  });

  it("disables smart search", () => {
    expect(FREE_CAPS.smartSearch).toBe(false);
  });

  it("disables audit log", () => {
    expect(FREE_CAPS.auditLog).toBe(false);
  });
});

describe("PRO_CAPS", () => {
  it("has 1000 monthly AI prompts", () => {
    expect(PRO_CAPS.aiMonthlyPrompts).toBe(1000);
  });

  it("enables smart search", () => {
    expect(PRO_CAPS.smartSearch).toBe(true);
  });

  it("enables cloud sync", () => {
    expect(PRO_CAPS.cloudSync).toBe(true);
  });

  it("does NOT enable workspace sharing (that's Team only)", () => {
    expect(PRO_CAPS.workspaceSharing).toBe(false);
  });
});

describe("TEAM_CAPS", () => {
  it("enables workspace sharing", () => {
    expect(TEAM_CAPS.workspaceSharing).toBe(true);
  });

  it("enables audit log", () => {
    expect(TEAM_CAPS.auditLog).toBe(true);
  });

  it("inherits all PRO_CAPS features", () => {
    expect(TEAM_CAPS.smartSearch).toBe(true);
    expect(TEAM_CAPS.persistentCollab).toBe(true);
    expect(TEAM_CAPS.cloudSync).toBe(true);
    expect(TEAM_CAPS.unlimitedDevices).toBe(true);
  });
});
