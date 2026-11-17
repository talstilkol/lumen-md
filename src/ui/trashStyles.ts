import type { CSSProperties } from "react";

/** The trash screen's buttons: a visible border and padding (preflight strips both from a bare <button>). */
export const trashBtn: CSSProperties = {
  padding: "4px 10px",
  minHeight: 28,
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid hsl(var(--border))",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

export const trashBtnPrimary: CSSProperties = {
  ...trashBtn,
  background: "hsl(var(--accent))",
  borderColor: "hsl(var(--accent))",
  color: "hsl(var(--accent-fg))",
  fontWeight: 600,
};
