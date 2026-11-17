/**
 * The app's own modules, for Playwright specs that drive them from inside
 * the page (W4.2). A spec used to `import("/src/…")` there, which only the
 * dev server answers; the production build that the e2e gate serves has no
 * /src/. Here the same modules load through the bundle's own chunks, so a
 * spec gets the very instances the app runs (one store, one vault).
 *
 * Installed as `window.__lumenTest` on the dev server and in a build made
 * with VITE_E2E=1 (scripts/vercel-build.mjs sets it for preview builds,
 * whose e2e gate needs it). A production build has neither: main.tsx's
 * check is a constant there, and the bundler drops this file.
 */
const MODULES = {
  "storage/workspace": () => import("../storage/workspace"),
  "storage/vault": () => import("../storage/vault/index"),
  "storage/vault/location": () => import("../storage/vault/location"),
  "storage/vault/encrypted/session": () => import("../storage/vault/encrypted/session"),
  "sync/git": () => import("../sync/git"),
  "store/gitPullDocs": () => import("../store/gitPullDocs"),
  "store/useStore": () => import("../store/useStore"),
  "ai/ocr": () => import("../ai/ocr"),
  // e2e/content-frame-origin.spec.ts: a content frame made by the app's own module (W6.40).
  "lib/contentFrame": () => import("../lib/contentFrame"),
  // e2e/rtl-parity/animations.spec.ts: a toast on demand, to read its entrance (plan 9.9).
  "ui/AiToast": () => import("../ui/AiToast"),
  // e2e/bulk-properties-1k.spec.ts: 1,000 notes in one bulk edit, timed in every engine (plan W7.4).
  "views/bulkEditRun": () => import("../views/bulkEditRun"),
  // e2e/voice-capture.spec.ts (W10.C8 test): a scripted live engine on the capture box's seam (plan W10.C8, 6.1).
  "capture/voiceCapture": () => import("../capture/voiceCapture"),
  // e2e/as-of.spec.ts: the open note's past versions, filed as autosave files them (W12.S2).
  "storage/history": () => import("../storage/history"),
  // e2e/conflict-3way.spec.ts: the conflict dialog as sync opens it (W12.S3).
  "sync/cloud/ConflictDialog": () => import("../sync/cloud/ConflictDialog"),
  // e2e/immersive-reader.spec.ts: the Reading mode menu, as the toolbar opens it (W13.R1, W13.R5).
  "ui/ReadingModeMenu": () => import("../ui/ReadingModeMenu"),
  // e2e/paged-preview.spec.ts: the PDF export's document, printed to count its pages (W13.R10).
  "ui/PrintExport": () => import("../ui/PrintExport"),
  // e2e/reading-modes.spec.ts: the compare view of two texts (W13.R8), as version history opens it.
  "reading/openCompare": () => import("../reading/openCompare"),
};

export type E2eModuleName = keyof typeof MODULES;
export type E2eModule<K extends E2eModuleName> = Awaited<ReturnType<(typeof MODULES)[K]>>;

export interface LumenTestHooks {
  /** One of the app's modules, as the running app has it. */
  load<K extends E2eModuleName>(name: K): Promise<E2eModule<K>>;
  /** The names `load` knows. */
  modules: E2eModuleName[];
}

export function installE2eHooks(target: { __lumenTest?: LumenTestHooks } = window as unknown as { __lumenTest?: LumenTestHooks }): void {
  target.__lumenTest = {
    load<K extends E2eModuleName>(name: K) {
      return MODULES[name]() as unknown as Promise<E2eModule<K>>;
    },
    modules: Object.keys(MODULES) as E2eModuleName[],
  };
}
