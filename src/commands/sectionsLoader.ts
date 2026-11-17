/**
 * Plan 0.2: the palette's command domains (./domains, about 75 KB of source)
 * are not in the startup chunk. They load once, in their own chunk, right
 * after the first paint (or as soon as anything asks for a command), and
 * useCommands rebuilds the list when they arrive.
 *
 * `commandSections()` is the loaded list, or null before it has arrived;
 * `loadCommandSections()` starts the load (once) and resolves to the list;
 * tests that build the palette synchronously await it first.
 */
import type { Command } from "../ui/CommandPalette";
import type { CommandContext } from "./domains/context";

export type CommandSection = (ctx: CommandContext) => Command[];

let sections: ReadonlyArray<CommandSection> | null = null;
let pending: Promise<ReadonlyArray<CommandSection>> | null = null;
const listeners = new Set<() => void>();

export function commandSections(): ReadonlyArray<CommandSection> | null {
  return sections;
}

export function loadCommandSections(): Promise<ReadonlyArray<CommandSection>> {
  if (sections) return Promise.resolve(sections);
  pending ??= import("./domains").then(
    (m) => {
      sections = m.COMMAND_SECTIONS;
      for (const l of [...listeners]) l();
      return m.COMMAND_SECTIONS;
    },
    (e: unknown) => {
      // A failed chunk load (offline after an update) can be retried by the next caller.
      pending = null;
      throw e;
    },
  );
  return pending;
}

/**
 * Review 10 M1: whether a command list was built with the domains. The
 * listener in hooks/useCommandEvents decides from the list it has (not from
 * `commandSections()`): the chunk can have arrived before the list is rebuilt.
 */
const withSections = new WeakSet<object>();
export function markBuiltWithSections<T extends object>(list: T): T {
  withSections.add(list);
  return list;
}
export function builtWithSections(list: object): boolean {
  return withSections.has(list);
}

export function onCommandSections(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts the load when the browser is idle (at most `timeout` ms after the first paint). */
export function loadCommandSectionsWhenIdle(timeout = 1500): void {
  if (sections || pending) return;
  const run = () => void loadCommandSections().catch((e: unknown) => console.warn("[lumen] command palette chunk failed to load", e));
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(run, { timeout });
  else setTimeout(run, 0);
}
