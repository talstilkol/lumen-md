/**
 * Entitlement enforcement (β.3.6 / β.3.7): gates, AI quota, and the gated
 * UI entry points (AuditLog, CollabSettings) in both modes:
 *   - self-hosted: no VITE_ENTITLEMENT_ENDPOINT → everything unlocked
 *   - billed: endpoint configured (or dev tier shim) → plan limits apply
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));
vi.mock("../lib/audit", () => ({
  listAudit: vi.fn().mockResolvedValue([
    { user_id: "u1", org_id: "o", action: "doc.publish", payload_json: "{}", ts: 1714200000000 },
  ]),
  recordAudit: vi.fn(),
}));

import { useEntitlement, __setEntitlementEndpointForTesting } from "../billing/useEntitlement";
import { FREE_CAPS, PRO_CAPS, TEAM_CAPS } from "../billing/types";
import { gatesEnforced, effectiveCapabilities } from "../billing/gates";
import {
  monthKey,
  getAiUsage,
  recordAiPrompt,
  aiQuotaStatus,
  consumeAiPrompt,
  isAiPromptCommand,
  withAiQuota,
  chargeAiCommandDispatch,
} from "../billing/aiQuota";
import { showAiToast } from "../ui/AiToast";
import { useAppStore } from "../store/useStore";
import { listAudit } from "../lib/audit";
import { AuditLog } from "../ui/AuditLog";
import { CollabSettings } from "../ui/CollabSettings";

const ENDPOINT = "https://billing.lumen.test/entitlement";

function setCaps(caps: typeof FREE_CAPS) {
  useEntitlement.setState({ capabilities: caps, entitlement: null, loading: false });
}

beforeEach(() => {
  localStorage.clear();
  // A configured provider, so quota tests exercise counting (see the
  // no-key test for the other path).
  useAppStore.setState({ aiKey: "sk-test" });
  vi.clearAllMocks();
  setCaps(FREE_CAPS);
});
afterEach(() => {
  __setEntitlementEndpointForTesting(null);
  localStorage.clear();
});

describe("self-hosted mode (no billing endpoint)", () => {
  it("does not enforce gates and unlocks every capability", () => {
    expect(gatesEnforced()).toBe(false);
    const caps = effectiveCapabilities();
    expect(caps.auditLog).toBe(true);
    expect(caps.persistentCollab).toBe(true);
    expect(caps.workspaceSharing).toBe(true);
    expect(caps.aiMonthlyPrompts).toBe(Number.POSITIVE_INFINITY);
  });

  it("treats placeholder endpoints as unconfigured", () => {
    __setEntitlementEndpointForTesting("https://example.com/placeholder");
    expect(gatesEnforced()).toBe(false);
  });

  it("never blocks AI prompts and writes nothing to storage", () => {
    for (let i = 0; i < 500; i++) expect(consumeAiPrompt()).toBe(true);
    expect(getAiUsage()).toBe(0);
    expect(aiQuotaStatus().allowed).toBe(true);
  });

  it("AuditLog renders the table even on FREE caps", async () => {
    render(<AuditLog open onClose={() => {}} orgId="o" />);
    await waitFor(() => expect(screen.getByText("doc.publish")).toBeTruthy());
    expect(screen.queryByTestId("upgrade-notice")).toBeNull();
  });

  it("CollabSettings lets the persistent server be saved", () => {
    const onClose = vi.fn();
    const { container } = render(<CollabSettings onClose={onClose} />);
    const ws = container.querySelector("#collab-persistent-url") as HTMLInputElement;
    expect(ws.disabled).toBe(false);
    fireEvent.change(ws, { target: { value: "wss://yjs.example.org" } });
    fireEvent.click(screen.getByText("Save"));
    expect(localStorage.getItem("lumen.collab.ws")).toBe("wss://yjs.example.org");
  });
});

describe("billed mode (endpoint configured)", () => {
  beforeEach(() => {
    __setEntitlementEndpointForTesting(ENDPOINT);
  });

  it("enforces the entitlement's capabilities", () => {
    expect(gatesEnforced()).toBe(true);
    expect(effectiveCapabilities().auditLog).toBe(false);
    setCaps(TEAM_CAPS);
    expect(effectiveCapabilities().auditLog).toBe(true);
  });

  it("AuditLog shows an upgrade notice and skips the fetch when not entitled", () => {
    render(<AuditLog open onClose={() => {}} orgId="o" />);
    expect(screen.getByTestId("upgrade-notice")).toBeTruthy();
    expect(screen.getByText("The audit log is available on the Team plan.")).toBeTruthy();
    expect(listAudit).not.toHaveBeenCalled();
  });

  it("AuditLog loads normally on the Team plan", async () => {
    setCaps(TEAM_CAPS);
    render(<AuditLog open onClose={() => {}} orgId="o" />);
    await waitFor(() => expect(listAudit).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("upgrade-notice")).toBeNull();
  });

  it("CollabSettings disables the persistent server on Free and clears a stale value", () => {
    localStorage.setItem("lumen.collab.ws", "wss://stale.example.org");
    const { container } = render(<CollabSettings onClose={() => {}} />);
    const ws = container.querySelector("#collab-persistent-url") as HTMLInputElement;
    expect(ws.disabled).toBe(true);
    expect(screen.getByTestId("upgrade-notice")).toBeTruthy();
    fireEvent.click(screen.getByText("Save"));
    expect(localStorage.getItem("lumen.collab.ws")).toBeNull();
  });

  it("CollabSettings enables the persistent server on Pro", () => {
    setCaps(PRO_CAPS);
    const { container } = render(<CollabSettings onClose={() => {}} />);
    const ws = container.querySelector("#collab-persistent-url") as HTMLInputElement;
    expect(ws.disabled).toBe(false);
    expect(screen.queryByTestId("upgrade-notice")).toBeNull();
  });

  it("doesn't spend a prompt when no AI provider is usable (no key)", () => {
    useAppStore.setState({ aiKey: null });
    const now = new Date(2026, 9, 15);
    expect(consumeAiPrompt(now, { silent: true })).toBe(false); // background: don't start
    expect(consumeAiPrompt(now)).toBe(true); // manual: proceed so chat() explains the missing key
    expect(getAiUsage(now)).toBe(0);
  });

  it("counts prompts for a keyless local provider", () => {
    useAppStore.setState({ aiKey: null });
    localStorage.setItem("lumen.ai.provider", "ollama");
    const now = new Date(2026, 9, 15);
    expect(consumeAiPrompt(now, { silent: true })).toBe(true);
    expect(getAiUsage(now)).toBe(1);
  });

  it("blocks AI prompts once the free monthly limit is reached", () => {
    const now = new Date(2026, 9, 15);
    localStorage.setItem(monthKey(now), String(FREE_CAPS.aiMonthlyPrompts - 1));
    expect(consumeAiPrompt(now)).toBe(true);
    expect(getAiUsage(now)).toBe(FREE_CAPS.aiMonthlyPrompts);
    expect(consumeAiPrompt(now)).toBe(false);
    expect(showAiToast).toHaveBeenCalledWith(expect.stringContaining("100"), "error");
    expect(aiQuotaStatus(now)).toMatchObject({ allowed: false, used: 100, limit: 100, remaining: 0 });
  });

  it("uses the Pro limit when entitled", () => {
    setCaps(PRO_CAPS);
    const now = new Date(2026, 9, 15);
    localStorage.setItem(monthKey(now), "100");
    expect(consumeAiPrompt(now)).toBe(true);
    expect(aiQuotaStatus(now).limit).toBe(1000);
  });
});

describe("dev tier shim enforces gates without an endpoint", () => {
  it("lumen.dev.tier=free enforces, =team unlocks the audit log", () => {
    localStorage.setItem("lumen.dev.tier", "free");
    expect(gatesEnforced()).toBe(true);
    expect(effectiveCapabilities().auditLog).toBe(false);
    useEntitlement.getState().setLocal("team");
    expect(effectiveCapabilities().auditLog).toBe(true);
  });
});

describe("aiQuota counter", () => {
  it("keys counters by calendar month and resets on a new month", () => {
    const oct = new Date(2026, 9, 31);
    const nov = new Date(2026, 10, 1);
    expect(monthKey(oct)).toBe("lumen.ai.quota.2026-10");
    recordAiPrompt(oct);
    recordAiPrompt(oct);
    expect(getAiUsage(oct)).toBe(2);
    expect(getAiUsage(nov)).toBe(0);
    recordAiPrompt(nov);
    // previous month's key is cleaned up
    expect(localStorage.getItem("lumen.ai.quota.2026-10")).toBeNull();
  });

  it("ignores corrupt values and survives storage failures", () => {
    localStorage.setItem(monthKey(), "garbage");
    expect(getAiUsage()).toBe(0);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getAiUsage()).toBe(0);
    expect(() => recordAiPrompt()).not.toThrow();
    spy.mockRestore();
    setSpy.mockRestore();
  });

  it("classifies AI prompt commands", () => {
    expect(isAiPromptCommand("ai.translate")).toBe(true);
    expect(isAiPromptCommand("ai.prompt.summarize-en")).toBe(true);
    expect(isAiPromptCommand("tools.autoTag")).toBe(true);
    expect(isAiPromptCommand("ai.settings")).toBe(false);
    expect(isAiPromptCommand("ai.switchProvider")).toBe(false);
    expect(isAiPromptCommand("file.save")).toBe(false);
  });

  it("withAiQuota wraps only AI prompt commands", () => {
    __setEntitlementEndpointForTesting(ENDPOINT);
    localStorage.setItem(monthKey(), "100");
    const aiAction = vi.fn();
    const saveAction = vi.fn();
    const cmds = withAiQuota([
      { id: "ai.diagram", action: aiAction },
      { id: "file.save", action: saveAction },
    ]);
    cmds[0].action();
    cmds[1].action();
    expect(aiAction).not.toHaveBeenCalled();
    expect(saveAction).toHaveBeenCalledTimes(1);
  });

  it("charges a wrapped command only when it actually dispatches, once", async () => {
    __setEntitlementEndpointForTesting(ENDPOINT);
    const now = new Date();
    // Cancelled dialog / failed prerequisite: no model call → not charged.
    const cancelled = withAiQuota([{ id: "ai.translate", action: async () => {} }]);
    await cancelled[0].action();
    expect(getAiUsage(now)).toBe(0);

    // A command that makes three model calls is charged once.
    const agent = withAiQuota([
      {
        id: "ai.productAgent",
        action: async () => {
          chargeAiCommandDispatch(now);
          chargeAiCommandDispatch(now);
          chargeAiCommandDispatch(now);
        },
      },
    ]);
    await agent[0].action();
    expect(getAiUsage(now)).toBe(1);
  });

  it("a prepaid request while a command waits leaves the command's own charge intact", async () => {
    __setEntitlementEndpointForTesting(ENDPOINT);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const { chat } = await import("../ai/llm");
    const now = new Date();
    let resume!: () => void;
    const dialog = new Promise<void>((r) => (resume = r));
    const translate = withAiQuota([
      {
        id: "ai.translate",
        action: async () => {
          await dialog; // user still typing the language
          chargeAiCommandDispatch(now); // the command's own model call
        },
      },
    ]);
    const running = translate[0].action() as unknown as Promise<void>;
    // e.g. the AI commit message counts itself and dispatches as prepaid.
    expect(consumeAiPrompt(now)).toBe(true);
    await chat([{ role: "user", content: "x" }], { prepaid: true, maxTokens: 1 }).catch(() => {});
    resume();
    await running;
    expect(getAiUsage(now)).toBe(2); // two model requests, two prompts
    vi.unstubAllGlobals();
  });

  it("re-checks the quota when a waiting command finally dispatches", async () => {
    __setEntitlementEndpointForTesting(ENDPOINT);
    const now = new Date();
    localStorage.setItem(monthKey(now), String(FREE_CAPS.aiMonthlyPrompts - 1)); // 99/100
    let resume!: () => void;
    const dialog = new Promise<void>((r) => (resume = r));
    let threw: unknown = null;
    const translate = withAiQuota([
      {
        id: "ai.translate",
        action: async () => {
          await dialog;
          try {
            chargeAiCommandDispatch(now);
          } catch (e) {
            threw = e;
          }
        },
      },
    ]);
    const running = translate[0].action() as unknown as Promise<void>; // passes the up-front check
    expect(consumeAiPrompt(now, { silent: true })).toBe(true); // inline suggestion takes prompt 100
    resume();
    await running;
    expect(threw).toBeInstanceOf(Error);
    expect(getAiUsage(now)).toBe(FREE_CAPS.aiMonthlyPrompts); // never 101
  });

  it("counts and enforces AI requests made outside the palette (commit message, voice memo, …)", () => {
    __setEntitlementEndpointForTesting(ENDPOINT);
    const now = new Date();
    chargeAiCommandDispatch(now); // unarmed, not prepaid → its own prompt
    expect(getAiUsage(now)).toBe(1);
    localStorage.setItem(monthKey(now), String(FREE_CAPS.aiMonthlyPrompts));
    expect(() => chargeAiCommandDispatch(now)).toThrow(/100/);
    expect(getAiUsage(now)).toBe(FREE_CAPS.aiMonthlyPrompts);
  });

  it("a background request counted by its caller doesn't also bill a command waiting in a dialog", async () => {
    __setEntitlementEndpointForTesting(ENDPOINT);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const { chat } = await import("../ai/llm");
    let finishDialog!: () => void;
    const dialog = new Promise<void>((r) => (finishDialog = r));
    const translate = withAiQuota([{ id: "ai.translate", action: () => dialog }]);
    const running = translate[0].action() as unknown as Promise<void>;
    // Inline suggestion fires meanwhile: counts itself, then dispatches as prepaid.
    expect(consumeAiPrompt(new Date(), { silent: true })).toBe(true);
    await chat([{ role: "user", content: "x" }], { prepaid: true, maxTokens: 1 }).catch(() => {});
    finishDialog(); // user cancels the translation
    await running;
    expect(getAiUsage()).toBe(1);
    vi.unstubAllGlobals();
  });
});
