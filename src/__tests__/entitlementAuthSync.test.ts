/**
 * Entitlements follow the signed-in identity: a sign-in after mount (or a
 * session restore that finishes after the first refresh) re-fetches the
 * plan, and an older slow refresh never overwrites a newer result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { useAuth } from "../auth/useAuth";
import {
  useEntitlement,
  watchAuthForEntitlements,
  __setEntitlementEndpointForTesting,
} from "../billing/useEntitlement";
import { FREE_CAPS, PRO_CAPS } from "../billing/types";
import type { AuthProvider } from "../auth/types";

const provider = (token: string | null): AuthProvider => ({
  name: "supabase",
  loadSession: async () => null,
  signOut: async () => {},
  getAccessToken: async () => token,
});

let unwatch: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  __setEntitlementEndpointForTesting("https://billing.lumen.test/entitlements");
  useEntitlement.setState({ entitlement: null, capabilities: FREE_CAPS, loading: false });
  useAuth.setState({ status: "anonymous", user: null, provider: provider(null) });
});
afterEach(() => {
  unwatch();
  vi.unstubAllGlobals();
  __setEntitlementEndpointForTesting(null);
});

describe("watchAuthForEntitlements", () => {
  it("refreshes after a sign-in that happens after mount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ entitlement: { tier: "pro", status: "active" } }), { status: 200 })),
    );
    unwatch = watchAuthForEntitlements();
    await useEntitlement.getState().refresh(); // the mount-time refresh, anonymous
    expect(useEntitlement.getState().capabilities).toEqual(FREE_CAPS);

    useAuth.setState({ status: "authenticated", user: { id: "u1", provider: "supabase" } as never, provider: provider("jwt") });
    await vi.waitFor(() => expect(useEntitlement.getState().capabilities).toEqual(PRO_CAPS));

    useAuth.setState({ status: "anonymous", user: null });
    await vi.waitFor(() => expect(useEntitlement.getState().capabilities).toEqual(FREE_CAPS));
  });

  it("an older, slower refresh does not overwrite a newer one", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => (releaseSlow = r));
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) {
          await slow;
          return new Response(JSON.stringify({ entitlement: { tier: "free", status: "none" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ entitlement: { tier: "pro", status: "active" } }), { status: 200 });
      }),
    );
    useAuth.setState({ status: "authenticated", user: { id: "u1", provider: "supabase" } as never, provider: provider("jwt") });
    const first = useEntitlement.getState().refresh();
    await useEntitlement.getState().refresh();
    releaseSlow();
    await first;
    expect(useEntitlement.getState().capabilities).toEqual(PRO_CAPS);
  });
});
