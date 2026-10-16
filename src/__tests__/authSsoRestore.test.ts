/**
 * initAuth: when Supabase and WorkOS SSO are both configured, a WorkOS
 * session (e.g. right after the `?sso=ok` callback) must be restored even
 * though Supabase is the primary provider.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const supabaseProvider = {
  name: "supabase",
  loadSession: vi.fn(async () => null as unknown),
  signOut: vi.fn(async () => {}),
};
const workosProvider = {
  name: "workos",
  loadSession: vi.fn(async () => null as unknown),
  signOut: vi.fn(async () => {}),
};
let workosEnabled = true;

vi.mock("../auth/supabaseProvider", () => ({ createSupabaseProvider: async () => supabaseProvider }));
vi.mock("../auth/workosProvider", () => ({
  workosProvider,
  isWorkosEnabled: () => workosEnabled,
}));

async function freshAuth() {
  vi.resetModules();
  return import("../auth/useAuth");
}

beforeEach(() => {
  vi.clearAllMocks();
  workosEnabled = true;
  supabaseProvider.loadSession.mockResolvedValue(null);
  workosProvider.loadSession.mockResolvedValue(null);
});

describe("initAuth with Supabase + WorkOS configured", () => {
  it("restores a WorkOS session when Supabase has none, and switches provider", async () => {
    const sso = { id: "user_01", provider: "workos", email: "a@acme.com" };
    workosProvider.loadSession.mockResolvedValue(sso);
    const { initAuth, useAuth } = await freshAuth();
    await initAuth();
    const s = useAuth.getState();
    expect(s.status).toBe("authenticated");
    expect(s.user).toEqual(sso);
    expect(s.provider).toBe(workosProvider);
  });

  it("keeps the Supabase session and doesn't query WorkOS when Supabase has one", async () => {
    const sb = { id: "sb-1", provider: "supabase" };
    supabaseProvider.loadSession.mockResolvedValue(sb);
    const { initAuth, useAuth } = await freshAuth();
    await initAuth();
    expect(useAuth.getState().user).toEqual(sb);
    expect(useAuth.getState().provider).toBe(supabaseProvider);
    expect(workosProvider.loadSession).not.toHaveBeenCalled();
  });

  it("stays anonymous on Supabase when neither has a session or SSO is off", async () => {
    workosEnabled = false;
    workosProvider.loadSession.mockResolvedValue({ id: "x", provider: "workos" });
    const { initAuth, useAuth } = await freshAuth();
    await initAuth();
    expect(useAuth.getState().status).toBe("anonymous");
    expect(useAuth.getState().provider).toBe(supabaseProvider);
    expect(workosProvider.loadSession).not.toHaveBeenCalled();
  });
});

describe("signOut after a restored SSO session", () => {
  it("switches back to the primary (Supabase) provider", async () => {
    workosProvider.loadSession.mockResolvedValue({ id: "user_01", provider: "workos" });
    const { initAuth, useAuth } = await freshAuth();
    await initAuth();
    expect(useAuth.getState().provider).toBe(workosProvider);
    await useAuth.getState().signOut();
    expect(workosProvider.signOut).toHaveBeenCalled();
    expect(useAuth.getState().status).toBe("anonymous");
    expect(useAuth.getState().provider).toBe(supabaseProvider);
  });
});
