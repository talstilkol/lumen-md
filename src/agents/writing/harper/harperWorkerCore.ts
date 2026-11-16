/**
 * W13.W10 — what the Harper worker does, as plain functions (the worker
 * file only wires them to `self`; the tests call them directly).
 *
 * harper.js is loaded from the app's own origin (`vendor/harper/harper.js`,
 * copied there from node_modules on the Mac by scripts/writing/vendor-harper.mjs).
 * When the file is not there, every request answers "not-installed" and the
 * editor keeps its other English checks: nothing is fetched from elsewhere.
 */
import { lintData, type HarperLinterLike, type LintData } from "./harperEngine";

/** Where harper.js is served from, relative to the app's base. */
export const HARPER_PATH = "vendor/harper/harper.js";

export type WorkerRequest = { type: "lint"; id: number; text: string };
export type WorkerReply = { type: "lints"; id: number; lints: LintData[]; version: string } | { type: "not-installed"; id: number } | { type: "failed"; id: number; error: string };

/** harper.js's module shape (0.x): `LocalLinter` built over its bundled `binary`. */
export interface HarperModule {
  LocalLinter: new (opts: { binary: unknown }) => HarperLinterLike & { setup(): Promise<void> };
  binary: unknown;
  version?: string;
}

export type ModuleLoader = () => Promise<HarperModule>;

export function createHarperHost(load: ModuleLoader) {
  let ready: Promise<{ linter: HarperLinterLike; version: string } | null> | null = null;
  const linter = () =>
    (ready ??= (async () => {
      let mod: HarperModule;
      try {
        mod = await load();
      } catch {
        return null; // not installed (or not reachable on this origin)
      }
      const l = new mod.LocalLinter({ binary: mod.binary });
      await l.setup();
      return { linter: l, version: `harper.js@${mod.version ?? "unknown"}` };
    })());
  return async function handle(req: WorkerRequest): Promise<WorkerReply> {
    try {
      const h = await linter();
      if (!h) return { type: "not-installed", id: req.id };
      const lints = await h.linter.lint(req.text, { language: "plaintext" });
      return { type: "lints", id: req.id, lints: lints.map(lintData), version: h.version };
    } catch (e) {
      return { type: "failed", id: req.id, error: String((e as Error)?.message ?? e) };
    }
  };
}
