/**
 * Other UIs run a palette command by id (`lumen-run-command`, e.g. the
 * suggestions panel), and the usage dialog (plan W4.26) asks for every
 * command id (`lumen-open-usage`). W6.25: moved out of App.tsx unchanged.
 */
import { useEffect, useRef } from "react";
import type { Command } from "../ui/CommandPalette";
import { announceCommand } from "../research/usability/commandEvents";
import { countCommand } from "../metrics/count";
import { commandSections, loadCommandSections } from "../commands/sectionsLoader";

function findCommand(list: Command[], id: string): Command | undefined {
  for (const c of list) {
    if (c.id === id) return c;
    const child = c.children ? findCommand(c.children as Command[], id) : undefined;
    if (child) return child;
  }
  return undefined;
}

function run(cmd: Command): void {
  announceCommand(cmd.id);
  countCommand(cmd.id);
  void cmd.action();
}

/** Runs a palette command by id, through the listener below (so it waits for the domains' chunk, plan 0.2). */
export function runCommandById(id: string): void {
  window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id } }));
}

export function useCommandEvents(commands: Command[]): void {
  // The suggestions panel (and other UIs) re-run a palette command by id.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  // Plan 0.2: a command asked for before the domains' chunk arrived runs
  // once the rebuilt list has it.
  const waitingRef = useRef<string[]>([]);
  useEffect(() => {
    if (!waitingRef.current.length) return;
    const still: string[] = [];
    for (const id of waitingRef.current) {
      const cmd = findCommand(commands, id);
      if (cmd) run(cmd);
      else if (!commandSections()) still.push(id);
    }
    waitingRef.current = still;
  }, [commands]);
  useEffect(() => {
    const onRun = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      const cmd = findCommand(commandsRef.current, id);
      if (cmd) run(cmd);
      else if (!commandSections()) {
        waitingRef.current.push(id);
        void loadCommandSections().catch((err: unknown) => console.warn("[lumen] command palette chunk failed to load", err));
      }
    };
    // The usage dialog (plan W4.26) needs every command id to name the unused ones; the beta panel's report (W6.31) names only these.
    const commandIds = () => {
      const ids: string[] = [];
      const walk = (list: typeof commands) => {
        for (const c of list) {
          ids.push(c.id);
          if (c.children) walk(c.children as typeof commands);
        }
      };
      walk(commandsRef.current);
      return ids;
    };
    const onUsage = () => void import("../ui/UsageDialog").then((m) => m.openUsage({ commandIds: commandIds() }));
    const onBeta = () => void import("../ui/BetaPanel").then((m) => m.openBeta({ commandIds: commandIds() }));
    window.addEventListener("lumen-run-command", onRun);
    window.addEventListener("lumen-open-usage", onUsage);
    window.addEventListener("lumen-open-beta", onBeta);
    return () => {
      window.removeEventListener("lumen-run-command", onRun);
      window.removeEventListener("lumen-open-usage", onUsage);
      window.removeEventListener("lumen-open-beta", onBeta);
    };
  }, []);
}
