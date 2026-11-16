/**
 * Plan 0.2: the palette's command domains (src/commands/domains, about
 * 75 KB of source) stay out of the startup bundle. They load in their own
 * chunk after the first paint; the list rebuilds when they arrive, and a
 * command asked for by id before then runs once it is there.
 *
 * This file must not import helpers/commandSections (it checks the list
 * before the chunk has loaded).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCommands, type UseCommandsOptions } from "../commands/useCommands";
import { commandSections, loadCommandSections } from "../commands/sectionsLoader";

const SRC = resolve(__dirname, "..");

/** Files reached from src/main.tsx through static (value) imports only. */
function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  const spec = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(spec)) {
      const s = m[1];
      if (!s.startsWith(".")) continue;
      const base = resolve(dirname(file), s);
      const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((p) => /\.(ts|tsx)$/.test(p) && existsSync(p));
      if (hit) todo.push(hit);
    }
  }
  return seen;
}

function options(): UseCommandsOptions {
  const fn = () => {};
  return {
    handleNew: fn, handleOpen: fn, handleSave: fn, handleExportHtml: fn, handleSaveToWorkspace: fn, insertSnippet: fn,
    recents: [], setRecents: fn, handleReopenRecent: fn, collab: null, handleStartCollab: fn, handleStopCollab: fn,
    setSearchOpen: fn, setFindReplaceOpen: fn, setGraphOpen: fn, setHistoryOpen: fn, setTableEditorOpen: fn,
    setCanvasOpen: fn, setGalleryOpen: fn,
  };
}

describe("command domains load lazily (plan 0.2)", () => {
  it("no domain builder is in the static import closure of src/main.tsx", () => {
    const reached = [...staticClosure(join(SRC, "main.tsx"))].map((p) => relative(SRC, p).replace(/\\/g, "/"));
    const domains = reached.filter((p) => p.startsWith("commands/domains/") && p !== "commands/domains/context.ts");
    expect(domains).toEqual([]);
    // The scan itself works: the hook is reached.
    expect(reached).toContain("commands/useCommands.ts");
  });

  it("the list has no domain commands before the chunk, and all of them after", async () => {
    expect(commandSections()).toBeNull();
    const { result } = renderHook(() => useCommands(options()));
    expect(result.current.find((c) => c.id === "view.source")).toBeUndefined();
    await act(async () => {
      await loadCommandSections();
    });
    await waitFor(() => expect(result.current.find((c) => c.id === "view.source")).toBeDefined());
    expect(result.current.length).toBeGreaterThan(100);
  });
});
