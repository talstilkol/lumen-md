import type { AuthProvider, User } from "./types";

/**
 * Local-only auth provider — used when no external auth is configured.
 *
 * `loadSession` always resolves to `null` (anonymous). Sign-in helpers throw
 * a friendly error so the UI knows to direct the user to the cloud features
 * setup screen. The provider exists so the rest of the app can call
 * `auth.signOut()`, `auth.loadSession()` etc. unconditionally without
 * branching on presence of credentials.
 */

const NotConfigured = (action: string) => () =>
  Promise.reject(
    new Error(
      `${action} requires Lumen Cloud. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.`,
    ),
  ) as Promise<User>;

export const localProvider: AuthProvider = {
  name: "local",
  loadSession: () => Promise.resolve(null),
  signInWithPassword: NotConfigured("Sign in"),
  signUpWithPassword: NotConfigured("Sign up"),
  signInWithProvider: NotConfigured("OAuth sign in"),
  signOut: () => Promise.resolve(),
};
