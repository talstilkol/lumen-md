/** The role-vault screens' few styles: the classroom panel's (../../classroom/ClassroomPanel.tsx), so both look alike. */
import type { CSSProperties } from "react";

export const muted: CSSProperties = { fontSize: 13, color: "hsl(var(--fg-muted))" };
export const errorStyle: CSSProperties = { fontSize: 13, color: "hsl(var(--danger))" };
export const field: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: "transparent", color: "inherit", font: "inherit" };
export const ghost: CSSProperties = { padding: "5px 12px", fontSize: 13, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };
export const primary: CSSProperties = { ...ghost, background: "hsl(var(--accent))", borderColor: "hsl(var(--accent))", color: "white" };
export const card: CSSProperties = { border: "1px solid hsl(var(--border))", borderRadius: 8, padding: 12, display: "grid", gap: 8 };
export const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
export const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 };
export const badge: CSSProperties = { fontSize: 12, padding: "1px 8px", borderRadius: 999, border: "1px solid hsl(var(--border))" };
