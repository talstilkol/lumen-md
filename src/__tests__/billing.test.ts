/**
 * Tests for the entitlement → capabilities mapping. The capabilities table is
 * the contract that every Pro feature reads, so it's worth pinning down.
 */

import { describe, it, expect } from "vitest";
import {
  capabilitiesFor,
  FREE_CAPS,
  PRO_CAPS,
  TEAM_CAPS,
} from "../billing/types";

describe("capabilitiesFor", () => {
  it("returns FREE caps when no entitlement", () => {
    expect(capabilitiesFor(null)).toEqual(FREE_CAPS);
  });

  it("returns FREE caps when entitlement is canceled", () => {
    expect(
      capabilitiesFor({ tier: "pro", status: "canceled" }),
    ).toEqual(FREE_CAPS);
  });

  it("returns PRO caps when active", () => {
    expect(
      capabilitiesFor({ tier: "pro", status: "active" }),
    ).toEqual(PRO_CAPS);
  });

  it("returns PRO caps when trialing", () => {
    expect(
      capabilitiesFor({ tier: "pro", status: "trialing" }),
    ).toEqual(PRO_CAPS);
  });

  it("returns TEAM caps for active team plan", () => {
    expect(
      capabilitiesFor({ tier: "team", status: "active" }),
    ).toEqual(TEAM_CAPS);
  });

  it("TEAM caps include workspaceSharing + auditLog", () => {
    expect(TEAM_CAPS.workspaceSharing).toBe(true);
    expect(TEAM_CAPS.auditLog).toBe(true);
  });

  it("FREE caps deny smartSearch / persistentCollab / cloudSync", () => {
    expect(FREE_CAPS.smartSearch).toBe(false);
    expect(FREE_CAPS.persistentCollab).toBe(false);
    expect(FREE_CAPS.cloudSync).toBe(false);
  });
});
