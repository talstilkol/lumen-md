import { useState } from "react";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { AuthDialog } from "./AuthDialog";

/**
 * Toolbar entry-point for sign in / out. Renders a tiny pill on the right
 * side of the title bar — anonymous users see "Sign in", authenticated
 * users see their initial / avatar with a click-to-sign-out menu.
 */

export function AuthButton() {
  const { status, user, signOut } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (status === "loading") {
    return null;
  }

  if (status === "authenticated" && user) {
    const initial = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();
    return (
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Account menu for ${user.email ?? user.name ?? "you"}`}
          title={user.email ?? user.name ?? "Account"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            border: "1px solid hsl(var(--border))",
            borderRadius: 999,
            background: "hsl(var(--bg-subtle))",
            color: "hsl(var(--fg))",
            cursor: "pointer",
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              width={20}
              height={20}
              style={{ borderRadius: 999, objectFit: "cover" }}
            />
          ) : (
            <span
              aria-hidden
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: "linear-gradient(135deg,#7c5cff,#22d3ee)",
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              {initial}
            </span>
          )}
          <span
            style={{
              maxWidth: 100,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.name ?? user.email}
          </span>
        </button>
        {menuOpen && (
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              insetInlineEnd: 0,
              minWidth: 200,
              background: "hsl(var(--bg))",
              border: "1px solid hsl(var(--border-strong))",
              borderRadius: 10,
              boxShadow: "0 12px 40px -8px hsl(0 0% 0% / 0.35)",
              zIndex: 100,
              padding: "6px 0",
            }}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <div
              style={{
                padding: "6px 12px 8px",
                fontSize: 11,
                color: "hsl(var(--fg-muted))",
                borderBottom: "1px solid hsl(var(--border))",
              }}
            >
              Signed in as
              <div style={{ color: "hsl(var(--fg))", fontWeight: 500, fontSize: 12, marginTop: 2 }}>
                {user.email ?? user.name ?? user.id}
              </div>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setMenuOpen(false);
                await signOut();
              }}
              style={menuItemStyle}
            >
              <LogOut size={13} aria-hidden /> Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        aria-label="Sign in"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          border: "1px solid hsl(var(--border))",
          borderRadius: 999,
          background: "transparent",
          color: "hsl(var(--fg))",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        <LogIn size={13} aria-hidden /> Sign in
      </button>
      <AuthDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 12px",
  border: "none",
  background: "transparent",
  color: "hsl(var(--fg))",
  fontSize: 13,
  cursor: "pointer",
  textAlign: "start",
};

// keep an unused import alive for downstream usage of UserIcon
void UserIcon;
