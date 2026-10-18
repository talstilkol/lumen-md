/**
 * SearchDialog honours the plan gates: Smart (embedding) search needs the
 * `smartSearch` capability, and each Ask-Workspace question spends one AI
 * prompt from the monthly quota. Self-hosted (no billing) stays unlocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../storage/workspaceIndex", () => ({ searchWorkspace: vi.fn(async () => []) }));
vi.mock("../storage/workspace", () => ({
  isOPFSAvailable: () => true,
  readWorkspaceFile: vi.fn(async () => ""),
}));
const searchHybrid = vi.fn(async () => []);
vi.mock("../ai/semanticSearch", () => ({
  indexWorkspace: vi.fn(),
  searchHybrid: (...a: unknown[]) => searchHybrid(...(a as [])),
}));
vi.mock("../ai/embeddings", () => ({ semanticSearch: vi.fn(async () => []) }));
const chat = vi.fn(async () => "answer");
vi.mock("../ai/llm", async (orig) => ({
  ...(await orig<typeof import("../ai/llm")>()),
  chat: (...a: unknown[]) => chat(...(a as [])),
}));
vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));
type RerankItems = Array<Record<string, unknown>>;
const rerankImpl = vi.fn(async (_q: string, items: RerankItems, _o?: { signal?: AbortSignal }) =>
  items.map((i) => ({ ...i, rerankScore: 1 })),
);
vi.mock("../ai/reranker", () => ({
  rerank: (...a: unknown[]) => rerankImpl(...(a as [string, RerankItems, { signal?: AbortSignal }])),
}));

import { SearchDialog } from "../ui/SearchDialog";
import { useEntitlement, __setEntitlementEndpointForTesting } from "../billing/useEntitlement";
import { FREE_CAPS, PRO_CAPS } from "../billing/types";
import { getAiUsage, recordAiPrompt, consumeAiPrompt } from "../billing/aiQuota";
import { showAiToast } from "../ui/AiToast";
import { useAppStore } from "../store/useStore";

function setCaps(caps: typeof FREE_CAPS) {
  useEntitlement.setState({ capabilities: caps, entitlement: null, loading: false });
}
function openOn(mode: "smart" | "ai") {
  (window as unknown as { __lumenSearchMode?: string }).__lumenSearchMode = mode;
  render(<SearchDialog open onClose={() => {}} onOpenFile={() => {}} />);
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ aiKey: "sk-test" }); // a usable provider, so prompts count
  vi.clearAllMocks();
  setCaps(FREE_CAPS);
});
afterEach(() => {
  cleanup();
  __setEntitlementEndpointForTesting(null);
  localStorage.clear();
});

describe("Smart search gate", () => {
  it("free plan with billing: shows an upgrade notice and never queries embeddings", async () => {
    __setEntitlementEndpointForTesting("https://billing.lumen.test/entitlements");
    openOn("smart");
    expect(await screen.findByTestId("upgrade-notice")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "quarterly plan" } });
    await new Promise((r) => setTimeout(r, 300));
    expect(searchHybrid).not.toHaveBeenCalled();
    expect(screen.queryByText(/Build index|Re-index/)).toBeNull();
  });

  it("Pro plan with billing: smart search runs", async () => {
    __setEntitlementEndpointForTesting("https://billing.lumen.test/entitlements");
    setCaps(PRO_CAPS);
    openOn("smart");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "quarterly plan" } });
    await waitFor(() => expect(searchHybrid).toHaveBeenCalled());
    expect(screen.queryByTestId("upgrade-notice")).toBeNull();
  });

  it("self-hosted (no billing): unlocked even on FREE caps", async () => {
    openOn("smart");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "quarterly plan" } });
    await waitFor(() => expect(searchHybrid).toHaveBeenCalled());
    expect(screen.queryByTestId("upgrade-notice")).toBeNull();
  });
});

describe("Smart search rerank", () => {
  it("aborts the stale model rerank when the query changes", async () => {
    searchHybrid.mockImplementation((async () => [
      { path: "a.md", snippet: "a", score: 1 },
      { path: "b.md", snippet: "b", score: 0.5 },
    ]) as unknown as () => Promise<never[]>);
    const signals: AbortSignal[] = [];
    rerankImpl.mockImplementationOnce((_q, _items, o) => {
      signals.push(o!.signal!);
      return new Promise(() => {}); // a long inference still in the worker
    });
    try {
      openOn("smart");
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "first" } });
      await waitFor(() => expect(signals).toHaveLength(1));
      expect(signals[0].aborted).toBe(false);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "first second" } });
      expect(signals[0].aborted).toBe(true);
    } finally {
      searchHybrid.mockImplementation(async () => []);
    }
  });
});

describe("Ask Workspace spends the AI quota", () => {
  it("asks chat() to charge the question itself, when it is actually sent", async () => {
    __setEntitlementEndpointForTesting("https://billing.lumen.test/entitlements");
    openOn("ai");
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "what changed?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect((chat.mock.calls[0] as unknown[])[1]).toMatchObject({ ownPrompt: true });
    // Nothing is counted up front: chat() charges at dispatch (llm tests).
    expect(getAiUsage()).toBe(0);
  });
});

describe("silent quota checks for background callers", () => {
  it("returns false without a toast when exhausted", () => {
    __setEntitlementEndpointForTesting("https://billing.lumen.test/entitlements");
    for (let i = 0; i < FREE_CAPS.aiMonthlyPrompts; i++) recordAiPrompt();
    expect(consumeAiPrompt(new Date(), { silent: true })).toBe(false);
    expect(showAiToast).not.toHaveBeenCalled();
  });
});
