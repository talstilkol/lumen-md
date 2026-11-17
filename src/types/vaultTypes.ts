/**
 * The vault's types in the app (plan W12.T1–T3): `.lumen/types/*.yaml`
 * read from the workspace, as a registry, reloaded when a type file
 * changes. Built-in types from other features (W12.E1's entity types)
 * register with `registerBuiltinTypes` and are merged in.
 */
import { useEffect, useState } from "react";
import { isOPFSAvailable, listWorkspaceFolder, readWorkspaceFile } from "../storage/workspace";
import { onWorkspaceChanged } from "../storage/workspaceEvents";
import { log } from "../lib/logger";
import { TYPES_DIR, type TypeDef } from "./typeSchema";
import { argumentTypes } from "../argument/argumentTypes";
import { loadTypeRegistry, type TypeRegistry } from "./typeRegistry";
import { TYPES_CHANGED_EVENT } from "./typeEvents";
import { ENTITY_TYPES_FEATURE, entityTypeDefs } from "../entities/types";
export { OPEN_TYPE_PAGE, TYPES_CHANGED_EVENT, openTypePage } from "./typeEvents";

const builtins = new Map<string, TypeDef[]>();
// W12.V4: the argument map's claim and source types ship with the app.
builtins.set("argument-map", argumentTypes());
// W12.X2: the reading list's "source" type ships with the app as the entity type `source`
// (entities/types.ts carries its fields), so the two features never declare it twice.

/** Types a feature ships in code (`feature` replaces its earlier set). */
export function registerBuiltinTypes(feature: string, defs: readonly TypeDef[]): void {
  builtins.set(feature, [...defs]);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TYPES_CHANGED_EVENT));
}

// W12.E1's entity types: a Base, "All <type>" in ⌘K and a field form for each.
registerBuiltinTypes(ENTITY_TYPES_FEATURE, entityTypeDefs());

export function builtinTypes(): TypeDef[] {
  return [...builtins.values()].flat();
}

/** The type files of the workspace (`.lumen/types/<id>.yaml`). */
export async function readTypeFiles(): Promise<Array<{ path: string; text: string }>> {
  if (!isOPFSAvailable()) return [];
  const out: Array<{ path: string; text: string }> = [];
  for (const name of await listWorkspaceFolder(TYPES_DIR)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const path = `${TYPES_DIR}/${name}`;
    try {
      out.push({ path, text: await readWorkspaceFile(path) });
    } catch (e) {
      log.warn("types: read failed", path, e);
    }
  }
  return out;
}

export async function loadVaultTypes(): Promise<TypeRegistry> {
  return loadTypeRegistry(await readTypeFiles(), builtinTypes());
}

/** The registry, kept current. */
export function useTypeRegistry(): TypeRegistry | null {
  const [reg, setReg] = useState<TypeRegistry | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void loadVaultTypes()
        .then((r) => !cancelled && setReg(r))
        .catch((e) => log.warn("types: load failed", e));
    load();
    const off = onWorkspaceChanged((c) => (!c.paths || c.paths.some((p) => p.startsWith(`${TYPES_DIR}/`))) && load(), { debounceMs: 300 });
    window.addEventListener(TYPES_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      off();
      window.removeEventListener(TYPES_CHANGED_EVENT, load);
    };
  }, []);
  return reg;
}
