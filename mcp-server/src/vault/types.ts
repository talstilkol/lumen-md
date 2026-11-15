/**
 * Typed objects over MCP and the CLI (plan W12.T4): `list_types`,
 * `get_type` and `create_object`, and `lumen types` / `lumen new --type`.
 *
 * The schema rules are the app's own (src/types/api.ts), bundled into
 * dist/types-engine.js by `npm run build` (scripts/bundle-bases.mjs), the
 * same way as the Bases engine; tests pass the source module in with
 * `setTypesEngine`. create_object never writes: a valid object becomes one
 * proposal in the approval queue (pending.ts), inside the client's folder
 * and tag scope (W11.I7); a value that does not fit the type is a schema
 * error and nothing is queued.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { readNote } from "./pending.js";
import { safeRel } from "./paths.js";
import { vaultFiles } from "./bases.js";

export interface TypeProblem {
  field: string;
  code: string;
  message: string;
}

export interface TypesEngineDeps {
  typeFiles(): Promise<Array<{ path: string; text: string }>>;
  paths?(): Promise<string[]>;
  readNote?(path: string): Promise<string | null>;
}

/** The part of src/types/api.ts this module uses. */
export interface TypesEngine {
  listTypes(deps: TypesEngineDeps): Promise<{ types: Array<{ id: string; label: { he?: string; en?: string }; tag?: string; extends?: string; fields: number; errors: string[] }>; errors: string[] }>;
  getType(deps: TypesEngineDeps, id: string): Promise<{ id: string; schema: Array<{ name: string; kind: string; to?: string; options?: string[]; from: string }> } | null>;
  planObject(deps: TypesEngineDeps, raw: unknown): Promise<{ ok: true; path: string; text: string; type: string } | { ok: false; problems: TypeProblem[] }>;
}

let engine: TypesEngine | null = null;

export function setTypesEngine(e: TypesEngine | null): void {
  engine = e;
}

export class TypesUnavailableError extends Error {}

export async function typesEngine(): Promise<TypesEngine> {
  if (engine) return engine;
  const spec = new URL("../types-engine.js", import.meta.url).href;
  try {
    engine = (await import(spec)) as TypesEngine;
  } catch (e) {
    if ((e as { code?: string })?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    throw new TypesUnavailableError("Types are not in this build of the server (dist/types-engine.js is missing). Build it with `npm run build` in mcp-server/ after `npm ci` in the repository root.");
  }
  return engine;
}

/** The vault's type files: `.lumen/types/*.yaml`. */
export async function typeFiles(vault: string): Promise<Array<{ path: string; text: string }>> {
  const dir = path.join(vault, ".lumen", "types");
  let names: string[];
  try {
    names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
  const out: Array<{ path: string; text: string }> = [];
  for (const n of names) out.push({ path: `.lumen/types/${n}`, text: await fs.readFile(path.join(dir, n), "utf8") });
  return out;
}

export function typesDeps(vault: string): TypesEngineDeps {
  return {
    typeFiles: () => typeFiles(vault),
    paths: () => vaultFiles(vault),
    readNote: (p) => readNote(vault, safeRel(p)),
  };
}

export function problemsText(problems: readonly TypeProblem[]): string {
  return problems.map((p) => `- ${p.message}`).join("\n");
}
