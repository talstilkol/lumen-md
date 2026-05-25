import { describe, it, expect } from "vitest";
import { localProvider } from "../auth/localProvider";

describe("localProvider", () => {
  it('has name "local"', () => {
    expect(localProvider.name).toBe("local");
  });

  it("loadSession always resolves to null (always anonymous)", async () => {
    const session = await localProvider.loadSession();
    expect(session).toBeNull();
  });

  it("signInWithPassword rejects with a helpful error message", async () => {
    await expect(
      localProvider.signInWithPassword!("a@b.com", "pw"),
    ).rejects.toThrow("VITE_SUPABASE_URL");
  });

  it("signUpWithPassword rejects with a helpful error message", async () => {
    await expect(
      localProvider.signUpWithPassword!("a@b.com", "pw"),
    ).rejects.toThrow("Lumen Cloud");
  });

  it("signInWithProvider rejects with a helpful error message", async () => {
    await expect(
      localProvider.signInWithProvider!("google"),
    ).rejects.toThrow("VITE_SUPABASE_ANON_KEY");
  });

  it("signOut resolves without error", async () => {
    await expect(localProvider.signOut()).resolves.toBeUndefined();
  });

  it("signInWithPassword rejection message mentions the action", async () => {
    await expect(
      localProvider.signInWithPassword!("x@y.com", "pass"),
    ).rejects.toThrow("Sign in");
  });

  it("signUpWithPassword rejection message mentions the action", async () => {
    await expect(
      localProvider.signUpWithPassword!("x@y.com", "pass"),
    ).rejects.toThrow("Sign up");
  });

  it("signInWithProvider rejection message mentions the action", async () => {
    await expect(
      localProvider.signInWithProvider!("github"),
    ).rejects.toThrow("OAuth sign in");
  });
});
