/**
 * ⌘K entries of typed objects (plan W12.T3): "Types: all objects by type",
 * and "All <type>" for every type of the vault. The type list loads after
 * startup (a dynamic import), so the registry and its YAML parser stay out
 * of the startup bundle.
 */
import { useEffect, useState } from "react";
import type { Command } from "../ui/CommandPalette";
import { cmdIcons } from "../ui/cmdIcons";
import { openObjectStudio, openTypePage, TYPES_CHANGED_EVENT } from "../types/typeEvents";
import { onWorkspaceChanged } from "../storage/workspaceEvents";

export interface TypeEntry {
  id: string;
  label: { he?: string; en?: string };
}

export function useTypeEntries(): TypeEntry[] {
  const [list, setList] = useState<TypeEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void import("../types/vaultTypes")
        .then((m) => m.loadVaultTypes())
        .then((reg) => !cancelled && setList([...reg.types.values()].map((t) => ({ id: t.id, label: t.label }))))
        .catch(() => undefined);
    load();
    const off = onWorkspaceChanged((c) => (!c.paths || c.paths.some((p) => p.startsWith(".lumen/types/"))) && load(), { debounceMs: 500 });
    window.addEventListener(TYPES_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      off();
      window.removeEventListener(TYPES_CHANGED_EVENT, load);
    };
  }, []);
  return list;
}

export function buildTypeCommands(types: readonly TypeEntry[], deps: { locale: string; t: (id: string, vars?: Record<string, string>) => string }): Command[] {
  const name = (e: TypeEntry) => (deps.locale === "he" ? (e.label.he ?? e.label.en) : (e.label.en ?? e.label.he)) ?? e.id;
  return [
    { id: "types.page", label: deps.t("cmd.typesPage"), icon: cmdIcons.Table, action: () => openTypePage() },
    // W12.T2: Object Studio — new type, add a field, rename a field everywhere, new note of a type.
    { id: "types.studio", label: deps.t("cmd.typesStudio"), icon: cmdIcons.Box, action: () => openObjectStudio() },
    ...types.map((e) => ({ id: `types.all.${e.id}`, label: deps.t("cmd.typesAll", { type: name(e) }), icon: cmdIcons.Table, action: () => openTypePage(e.id) })),
  ];
}
