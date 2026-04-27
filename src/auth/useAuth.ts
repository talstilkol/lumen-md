import { create } from "zustand";
import type { AuthProvider, AuthState, User } from "./types";
import { localProvider } from "./localProvider";
import { createSupabaseProvider } from "./supabaseProvider";
import { log } from "../lib/logger";

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
    return supabase ?? localProvider;
  })();
  return providerPromise;
}

function fail(state: AuthStore, action: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  log.warn(`auth ${action} failed`, message);
  state.status = "error";
  state.error = message;
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
      fail(get(), "signIn", err);
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
      fail(get(), "signUp", err);
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
      fail(get(), "oauth", err);
    }
  },
  signOut: async () => {
    const { provider } = get();
    try {
      await provider.signOut();
      set({ status: "anonymous", user: null });
    } catch (err) {
      fail(get(), "signOut", err);
    }
  },
}));

/**
 * Bootstraps the auth store. Call once from `main.tsx`. Re-calls are no-ops.
 * Resolves the active provider (Supabase if configured, otherwise local) and
 * loads any persisted session.
 */
export async function initAuth(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const provider = await resolveProvider();
    useAuth.setState({ provider });
    const user: User | null = await provider.loadSession();
    useAuth.setState({
      status: user ? "authenticated" : "anonymous",
      user,
    });
  } catch (err) {
    log.warn("auth init failed", err);
    useAuth.setState({ status: "error", error: String(err) });
  }
}
