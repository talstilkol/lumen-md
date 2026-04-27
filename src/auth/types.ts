/**
 * Shared types for the auth layer.
 *
 * Lumen is local-first: signing in is always optional. The auth surface
 * exists so that paid features (persistent collab rooms, cloud sync,
 * semantic search) can be gated behind an account, without forcing users
 * who just want a markdown editor to create one.
 */

export interface User {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  /** Provider that issued this session (e.g. "supabase", "local"). */
  provider: string;
}

export type AuthStatus = "loading" | "anonymous" | "authenticated" | "error";

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  error?: string;
}

export interface AuthProvider {
  /** Stable name shown in telemetry / UI. */
  name: string;
  /** Resolve the current session (or null if anonymous). */
  loadSession(): Promise<User | null>;
  /** Email + password sign-in. Returns the resulting user. */
  signInWithPassword?(email: string, password: string): Promise<User>;
  /** Email + password sign-up. Returns the resulting user. */
  signUpWithPassword?(email: string, password: string): Promise<User>;
  /** Open OAuth popup / redirect. Returns the resulting user. */
  signInWithProvider?(provider: "google" | "github"): Promise<User>;
  /** End the session. */
  signOut(): Promise<void>;
}
