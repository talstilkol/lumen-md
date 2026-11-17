/**
 * The look of a settings tab's own controls (MCP servers, Calendar). Under
 * Tailwind's preflight a bare <button> or <input> has no border and no
 * padding, so it reads as plain text; these give each a visible box, a
 * 28 px target and the app's colours, in light and dark alike.
 */
import type { CSSProperties } from "react";

export const btn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 28,
  padding: "4px 12px",
  borderRadius: 6,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--bg-subtle))",
  color: "hsl(var(--fg))",
  cursor: "pointer",
  fontSize: 13,
};

export const btnPrimary: CSSProperties = {
  ...btn,
  background: "hsl(var(--accent))",
  borderColor: "hsl(var(--accent))",
  color: "hsl(var(--accent-fg))",
  fontWeight: 600,
};

export const field: CSSProperties = {
  minHeight: 28,
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--bg))",
  color: "hsl(var(--fg))",
  minWidth: 0,
  font: "inherit",
  fontSize: 13,
};

export const card: CSSProperties = { border: "1px solid hsl(var(--border))", borderRadius: 8, padding: 12, margin: "8px 0", background: "hsl(var(--bg))" };
export const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "4px 0" };
export const muted: CSSProperties = { fontSize: 12, color: "hsl(var(--fg-muted))", margin: 0 };
export const heading: CSSProperties = { fontSize: 14, fontWeight: 600, margin: "16px 0 4px" };
/** A small label on a card (licence, what it reaches): text plus a border, never colour alone. */
export const chip: CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  lineHeight: "18px",
  padding: "0 8px",
  borderRadius: 999,
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--fg))",
  background: "hsl(var(--bg-subtle))",
};
