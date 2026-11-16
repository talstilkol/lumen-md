/**
 * esbuild for the scripts that bundle one module to check it (plan 6.10's
 * browser worker run, W1.31's production-build check). It is not a direct
 * dependency: Vite 8 bundles with rolldown, and esbuild comes with tsx. So:
 * a top-level esbuild when there is one, else the copy tsx depends on.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    return createRequire(fileURLToPath(import.meta.resolve("tsx")))("esbuild");
  }
}
