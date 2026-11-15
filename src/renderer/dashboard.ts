/**
 * Dashboard notes (plan W12.V6): `layout: dashboard` in a note's
 * frontmatter lays its embeds — ```query and ```dataview blocks, `.base`
 * embeds and their chart views, ```tasks, ```structure … — out as a
 * responsive grid. Prose (headings, paragraphs, lists) spans the whole row,
 * so the note still reads top to bottom; each block takes one cell.
 *
 * The grid is CSS only (src/index.css, `.lumen-dashboard`): it starts at the
 * inline start, so in Hebrew the first block is on the right. Nothing is
 * written to the note, and Obsidian, which ignores the `layout` property,
 * shows the same note as a plain note with its embeds.
 *
 * `dashboard-columns: 3` fixes the number of columns (1–6); without it the
 * grid fits as many 24rem columns as the width allows.
 */

export interface DashboardLayout {
  columns: number | null;
}

export function dashboardLayout(fm: Record<string, unknown> | null | undefined): DashboardLayout | null {
  if (!fm || typeof fm.layout !== "string" || fm.layout.trim().toLowerCase() !== "dashboard") return null;
  const n = Number(fm["dashboard-columns"]);
  return { columns: Number.isInteger(n) && n >= 1 && n <= 6 ? n : null };
}

/** The props the preview's content element takes for a layout (none for a plain note). */
export function dashboardProps(layout: DashboardLayout | null): { className: string; "data-layout"?: string; style?: Record<string, string> } {
  if (!layout) return { className: "prose-lumen" };
  return {
    className: "prose-lumen lumen-dashboard",
    "data-layout": "dashboard",
    ...(layout.columns ? { style: { "--lumen-dashboard-columns": String(layout.columns) } } : {}),
  };
}
