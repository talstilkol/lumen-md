/**
 * The pricing promise (W11.P12, coordinator decision 15.11): the free tier
 * never shrinks. `src/billing/gates.ts` may gate only services that run on a
 * host and cost money — never a local feature, even with a billing backend
 * configured and the user on the Free plan.
 *
 * This test enumerates every gate (HOSTED_GATES) and every capability, so a
 * new capability has to be classified here before it can ship, and a local
 * one can't be enforced by accident.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { useEntitlement, __setEntitlementEndpointForTesting } from "../billing/useEntitlement";
import { FREE_CAPS, PRO_CAPS, TEAM_CAPS, type Capabilities } from "../billing/types";
import {
  HOSTED_GATES,
  UNLOCKED_CAPS,
  effectiveCapabilities,
  gatesEnforced,
  isHostedGate,
} from "../billing/gates";
import { aiQuotaStatus, consumeAiPrompt, monthKey } from "../billing/aiQuota";
import { useAppStore } from "../store/useStore";

/** The hosted services a gate may name: each runs on a server and costs money. */
const HOSTED_SERVICES = new Set([
  "encrypted-relay",
  "persistent-collab-server",
  "workspace-sharing",
  "audit-log-worker",
  "hosted-publish",
]);

/** Capabilities that run on the device. Each must stay unlocked on every plan. */
const LOCAL_CAPABILITIES: Array<keyof Capabilities> = ["smartSearch", "aiMonthlyPrompts", "unlimitedDevices"];

const ALL_KEYS = Object.keys(UNLOCKED_CAPS) as Array<keyof Capabilities>;

function setCaps(caps: Capabilities) {
  useEntitlement.setState({ capabilities: caps, entitlement: null, loading: false, failed: false });
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ aiKey: "sk-test" });
  setCaps(FREE_CAPS);
});
afterEach(() => {
  __setEntitlementEndpointForTesting(null);
  localStorage.clear();
});

describe("every gate is a hosted service", () => {
  const gates = Object.entries(HOSTED_GATES);

  it("there is at least one gate, and every one runs on a host and costs money", () => {
    expect(gates.length).toBeGreaterThan(0);
    for (const [key, gate] of gates) {
      expect(gate.runsOn, key).toBe("host");
      expect(gate.costsMoney, key).toBe(true);
      expect(HOSTED_SERVICES.has(gate.service), `${key} → ${gate.service}`).toBe(true);
      expect(gate.why.trim().length, key).toBeGreaterThan(20);
    }
  });

  it("no local capability is a gate", () => {
    for (const key of LOCAL_CAPABILITIES) expect(isHostedGate(key), key).toBe(false);
  });

  it("every capability is classified: hosted gate or local", () => {
    for (const key of ALL_KEYS) {
      const classified = isHostedGate(key) !== LOCAL_CAPABILITIES.includes(key);
      expect(classified, `${key} must be exactly one of HOSTED_GATES / LOCAL_CAPABILITIES`).toBe(true);
    }
    // FREE/PRO/TEAM describe the same keys.
    for (const caps of [FREE_CAPS, PRO_CAPS, TEAM_CAPS]) expect(Object.keys(caps).sort()).toEqual([...ALL_KEYS].sort());
  });
});

describe("billing backend configured, Free plan", () => {
  beforeEach(() => {
    __setEntitlementEndpointForTesting("https://billing.lumen.test/entitlement");
    setCaps(FREE_CAPS);
  });

  it("gates are enforced, but every local capability reads unlocked", () => {
    expect(gatesEnforced()).toBe(true);
    const caps = effectiveCapabilities();
    for (const key of ALL_KEYS) {
      if (isHostedGate(key)) continue;
      expect(caps[key], key).toBe(UNLOCKED_CAPS[key]);
    }
  });

  it("hosted gates still follow the plan", () => {
    const free = effectiveCapabilities();
    for (const key of Object.keys(HOSTED_GATES) as Array<keyof Capabilities>) expect(free[key], key).toBe(FREE_CAPS[key]);
    setCaps(TEAM_CAPS);
    const team = effectiveCapabilities();
    for (const key of Object.keys(HOSTED_GATES) as Array<keyof Capabilities>) expect(team[key], key).toBe(TEAM_CAPS[key]);
  });

  it("AI with the user's own key or a local model is never blocked", () => {
    const now = new Date(2026, 10, 15);
    localStorage.setItem(monthKey(now), String(FREE_CAPS.aiMonthlyPrompts * 10));
    expect(aiQuotaStatus(now).allowed).toBe(true);
    expect(aiQuotaStatus(now).limit).toBe(Number.POSITIVE_INFINITY);
    expect(consumeAiPrompt(now)).toBe(true);
    useAppStore.setState({ aiKey: null });
    localStorage.setItem("lumen.ai.provider", "ollama");
    expect(consumeAiPrompt(now, { silent: true })).toBe(true);
  });
});

describe("feature code reads hosted gates only", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === "__tests__" || name === "node_modules") continue;
      if (statSync(p).isDirectory()) sources(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("every useCapability(...) / effectiveCapabilities().x in src names a hosted gate", () => {
    const uses: Array<{ file: string; key: string }> = [];
    for (const file of sources("src")) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/useCapability\(\s*["'](\w+)["']/g)) uses.push({ file, key: m[1] });
      for (const m of text.matchAll(/effectiveCapabilities\(\)\.(\w+)/g)) uses.push({ file, key: m[1] });
    }
    expect(uses.length).toBeGreaterThan(0);
    const offenders = uses.filter((u) => !isHostedGate(u.key));
    expect(offenders).toEqual([]);
  });
});
