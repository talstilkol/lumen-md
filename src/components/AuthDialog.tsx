import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";

/**
 * Email/password + OAuth sign-in dialog.
 *
 * Renders only the buttons the active provider supports. The local provider
 * exposes none of them, so the dialog falls back to a friendly "Lumen Cloud
 * not configured" notice with setup instructions.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = "signin" | "signup";

export function AuthDialog({ open, onClose }: Props) {
  const { provider, signIn, signUp, signInWithProvider } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setPassword("");
    setError(null);
    setMode("signin");
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const supportsPassword = !!provider.signInWithPassword;
  const supportsOauth = !!provider.signInWithProvider;
  const isLocal = provider.name === "local";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOauth(p: "google" | "github") {
    setSubmitting(true);
    setError(null);
    try {
      await signInWithProvider(p);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "hsl(0 0% 0% / 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        style={{
          background: "hsl(var(--bg))",
          color: "hsl(var(--fg))",
          border: "1px solid hsl(var(--border-strong))",
          borderRadius: 14,
          padding: 24,
          width: "min(420px, 100%)",
          boxShadow: "0 20px 60px -10px hsl(0 0% 0% / 0.5)",
        }}
      >
        <div id="auth-dialog-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          {mode === "signin" ? "Sign in" : "Create an account"}
        </div>
        <div style={{ fontSize: 12, color: "hsl(var(--fg-muted))", marginBottom: 16 }}>
          Sign-in is optional — Lumen works fully without an account. Sign in to
          unlock persistent collab rooms, cloud sync, and semantic search.
        </div>

        {isLocal ? (
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              background: "hsl(var(--bg-subtle))",
              border: "1px dashed hsl(var(--border))",
              fontSize: 12,
              color: "hsl(var(--fg-muted))",
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: "hsl(var(--fg))" }}>Lumen Cloud not configured.</strong>
            <br />
            Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>, then{" "}
            <code>npm install @supabase/supabase-js</code> to enable accounts.
          </div>
        ) : (
          <>
            {supportsPassword && (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }}>
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }}>
                  Password
                  <input
                    type="password"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    ...btnPrimary,
                    opacity: submitting ? 0.6 : 1,
                    cursor: submitting ? "wait" : "pointer",
                  }}
                >
                  {submitting ? "…" : mode === "signin" ? "Sign in" : "Create account"}
                </button>
              </form>
            )}

            {supportsOauth && (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    margin: "16px 0 12px",
                    fontSize: 11,
                    color: "hsl(var(--fg-muted))",
                  }}
                >
                  <div style={{ flex: 1, height: 1, background: "hsl(var(--border))" }} />
                  <span>or</span>
                  <div style={{ flex: 1, height: 1, background: "hsl(var(--border))" }} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={() => handleOauth("google")} disabled={submitting} style={btnSecondary}>
                    Continue with Google
                  </button>
                  <button type="button" onClick={() => handleOauth("github")} disabled={submitting} style={btnSecondary}>
                    Continue with GitHub
                  </button>
                </div>
              </>
            )}

            {supportsPassword && (
              <button
                type="button"
                onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
                style={{
                  marginTop: 14,
                  border: "none",
                  background: "transparent",
                  color: "hsl(var(--accent))",
                  fontSize: 12,
                  cursor: "pointer",
                  textAlign: "start",
                  padding: 0,
                }}
              >
                {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
              </button>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "hsl(0 80% 50% / 0.1)",
                  color: "hsl(0 80% 65%)",
                  border: "1px solid hsl(0 80% 50% / 0.4)",
                  fontSize: 12,
                }}
              >
                {error}
              </div>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "8px 12px",
            border: "1px solid hsl(var(--border))",
            background: "transparent",
            color: "hsl(var(--fg))",
            borderRadius: 8,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  background: "hsl(var(--bg-subtle))",
  color: "hsl(var(--fg))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  marginTop: 4,
  padding: "10px 14px",
  background: "linear-gradient(135deg,#7c5cff,#22d3ee)",
  color: "white",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  flex: 1,
  padding: "9px 12px",
  background: "hsl(var(--bg-subtle))",
  color: "hsl(var(--fg))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};
