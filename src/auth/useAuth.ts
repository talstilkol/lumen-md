import { create } from "zustand";
import type { AuthProvider, AuthState, User } from "./types";
import { localProvider } from "./localProvider";
import { createSupabaseProvider } from "./supabaseProvider";
import { workosProvider, isWorkosEnabled } from "./workosProvider";
import { consumeSsoFlash, describeAuthError } from "./authStatus";
import { log } from "../lib/logger";
import { toast } from "../store/useToastStore";
import { t } from "../i18n";

interface AuthStore extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithProvider: (provider: "google" | "github") => Promise<void>;
  signOut: () => Promise<void>;
  provider: AuthProvider;
}

let initialized = false;
let providerPromise: Promise<AuthProvider> | null = null;

async function resolveProvider(): Promise<AuthProvider> {
  if (providerPromise) return providerPromise;
  providerPromise = (async () => {
    const supabase = await createSupabaseProvider();
    if (supabase) return supabase;
    // Enterprise SSO only — the edge worker owns the session cookie.
    if (isWorkosEnabled()) return workosProvider;
    return localProvider;
  })();
  return providerPromise;
}

/**
 * Record a failed auth action. Uses `setState` (not mutation) so the
 * toolbar / status bar re-render with the error. A failed sign-in keeps
 * an existing session intact — only the error message is updated.
 */
function fail(action: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  log.warn(`auth ${action} failed`, message);
  const { user } = useAuth.getState();
  useAuth.setState(user ? { error: message } : { status: "error", error: message });
  throw err;
}

export const useAuth = create<AuthStore>((set, get) => ({
  status: "loading",
  user: null,
  provider: localProvider,
  signIn: async (email, password) => {
    const { provider } = get();
    if (!provider.signInWithPassword) {
      throw new Error("Password sign-in is not configured");
    }
    try {
      const user = await provider.signInWithPassword(email, password);
      set({ status: "authenticated", user, error: undefined });
    } catch (err) {
      fail("signIn", err);
    }
  },
  signUp: async (email, password) => {
    const { provider } = get();
    if (!provider.signUpWithPassword) {
      throw new Error("Sign-up is not configured");
    }
    try {
      const user = await provider.signUpWithPassword(email, password);
      set({ status: "authenticated", user, error: undefined });
    } catch (err) {
      fail("signUp", err);
    }
  },
  signInWithProvider: async (oauth) => {
    const { provider } = get();
    if (!provider.signInWithProvider) {
      throw new Error("OAuth is not configured");
    }
    try {
      const user = await provider.signInWithProvider(oauth);
      set({ status: "authenticated", user, error: undefined });
    } catch (err) {
      fail("oauth", err);
    }
  },
  signOut: async () => {
    const { provider } = get();
    try {
      await provider.signOut();
      set({ status: "anonymous", user: null });
    } catch (err) {
      fail("signOut", err);
    }
  },
}));

/**
 * Bootstraps the auth store. Call once from `main.tsx`. Re-calls are no-ops.
 * Resolves the active provider (Supabase if configured, otherwise WorkOS or
 * local) and loads any persisted session, falling back to a WorkOS SSO
 * session when SSO is configured alongside Supabase.
 */
export async function initAuth(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    let provider = await resolveProvider();
    useAuth.setState({ provider });
    let user: User | null = await provider.loadSession();
    // Supabase and WorkOS can both be configured (the sign-in dialog offers
    // SSO next to email/OAuth). The primary provider wins when it has a
    // session; otherwise restore an SSO session from the worker's cookie —
    // e.g. right after the `?sso=ok` callback redirect.
    if (!user && provider !== workosProvider && isWorkosEnabled()) {
      const ssoUser = await workosProvider.loadSession();
      if (ssoUser) {
        provider = workosProvider;
        user = ssoUser;
        useAuth.setState({ provider });
      }
    }
    useAuth.setState({
      status: user ? "authenticated" : "anonymous",
      user,
      error: undefined,
    });
    reportSsoFlash(user !== null);
  } catch (err) {
    log.warn("auth init failed", err);
    useAuth.setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/** Turn the SSO worker's `?sso=ok|error` redirect flag into a toast. */
function reportSsoFlash(hasSession: boolean): void {
  const flash = consumeSsoFlash();
  if (!flash) return;
  if (flash.ok && hasSession) {
    toast.success(t("auth.sso.success"));
    return;
  }
  const reason = flash.ok ? "sessionExpired" : flash.reason;
  const d = describeAuthError(reason);
  toast.error(t("auth.sso.failed"), d.hint, d.learnMoreUrl);
}
