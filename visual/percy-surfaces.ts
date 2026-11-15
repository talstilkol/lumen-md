/**
 * The 30 screens Percy snapshots (plan W7.25): the 10 surfaces of the local
 * baselines (10.3), the RTL matrix note (9.5), and 19 more views reached by
 * their palette command. Each runs in 4 variants (he / en × light / dark), and
 * Percy renders each snapshot in Chrome, Firefox and Safari: 30 × 4 × 3.
 */
import type { Page } from "@playwright/test";
import type { Surface } from "./harness";

const runCommand = (page: Page, id: string) =>
  page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

/**
 * A view opened by a palette command. `ready` is that view's own marker (plan
 * W7.25): a `data-testid` on the view's root, with `data-ready="true"` where the
 * view loads something first (a listing, a layout, a measurement). Never
 * "body": a body is visible before the view has rendered anything.
 */
export function commandSurface(id: string, command: string, ready: string): Surface & { command: string } {
  return { id, command, open: (p) => runCommand(p, command), ready };
}

/** The selector of a view's ready marker: its test id, and data-ready="true" when the view loads first. */
export const readyMarker = (testId: string, loads = false) => `[data-testid="${testId}"]${loads ? '[data-ready="true"]' : ""}`;

/** After the ready marker: waits until the page's DOM size is the same on two animation frames in a row (late paints settle). */
export async function domSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const size = () => document.body.innerHTML.length;
        const a = size();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(size() === a)));
      }),
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

export const COMMAND_SURFACES = [
  commandSurface("settings", "settings.open", readyMarker("settings-screen")),
  commandSurface("organization", "settings.organization", '[data-testid="settings-screen"] :is([data-testid="org-members"], [data-testid="org-members-empty"], [data-testid="org-local-only"])'),
  commandSurface("backlinks", "view.backlinks", readyMarker("backlinks-panel", true)),
  commandSurface("calendar", "view.calendar", readyMarker("calendar")),
  commandSurface("canvas", "view.canvas", readyMarker("canvas-whiteboard", true)),
  commandSurface("find-replace", "view.findReplace", readyMarker("find-replace")),
  commandSurface("graph", "view.graphView", `:is(${readyMarker("graph-view", true)}, ${readyMarker("graph-empty")})`),
  commandSurface("local-graph", "view.localGraph", readyMarker("local-graph")),
  commandSurface("highlights", "view.highlights", readyMarker("highlights-panel")),
  commandSurface("outline", "view.outline", readyMarker("outline", true)),
  commandSurface("page-view", "view.pageView", readyMarker("page-view", true)),
  commandSurface("properties", "view.properties", readyMarker("properties-panel")),
  commandSurface("reading", "view.reading", readyMarker("reading-mode", true)),
  commandSurface("reading-options", "view.readingOptions", readyMarker("reading-settings")),
  commandSurface("review", "view.review", `${readyMarker("review-panel")}[data-open-ms]`),
  commandSurface("search", "view.search", readyMarker("search-dialog")),
  commandSurface("tags", "view.tags", readyMarker("tags-panel", true)),
  commandSurface("version-history", "view.versionHistory", readyMarker("version-history", true)),
  commandSurface("workspace", "view.workspace", readyMarker("file-tree", true)),
];

/** The RTL matrix note in the preview (9.5): the screen where RTL regressions show first. */
export const RTL_MATRIX = { id: "rtl-matrix", open: (p: Page) => p.keyboard.press("Meta+3"), ready: ".prose-lumen table" } satisfies Surface;

/** The ten surfaces of harness.ts (10.3), by id: percy.percy.ts checks that harness.ts still has exactly these. */
export const BASE_SURFACE_IDS = ["split", "source", "preview", "wysiwyg", "palette", "shortcuts", "plugins", "templates", "theme-settings", "ai-settings"] as const;

/** All 30 screens, in order: the ten, the RTL matrix, the nineteen command views. */
export const PERCY_SCREEN_IDS: readonly string[] = [...BASE_SURFACE_IDS, RTL_MATRIX.id, ...COMMAND_SURFACES.map((s) => s.id)];

export function percySurfaces(base: readonly Surface[]): Surface[] {
  const ids = base.map((s) => s.id);
  if (JSON.stringify(ids) !== JSON.stringify(BASE_SURFACE_IDS)) throw new Error(`visual/harness.ts SURFACES changed (${ids.join(", ")}): update BASE_SURFACE_IDS`);
  return [...base, RTL_MATRIX, ...COMMAND_SURFACES];
}

/**
 * The deliberate 2px RTL change of the self-test (acceptance: caught in 3/3
 * browsers): RTL text in the preview moves 2px. Applied only when
 * LUMEN_PERCY_CANARY=1, in a build of its own that is never approved.
 */
export const RTL_CANARY_CSS = '[dir="rtl"] .prose-lumen { padding-inline-start: calc(var(--lumen-canary, 0px) + 2px) !important; }';
