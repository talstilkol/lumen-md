/**
 * Window events other parts of the app use to reach App: run a palette
 * command by id, open the AI settings, privacy ledger, trash or AI doctor,
 * focus the comments panel; plus two deferred start-up jobs (trash purge,
 * the improvement agent's model critic). Moved out of App.tsx (plan 12.1);
 * App calls this where the effects were. The state setters, stable for the
 * component's life, are now listed as dependencies because they arrive as
 * arguments.
 */
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Command } from "../ui/CommandPalette";
import { isOPFSAvailable } from "../storage/workspace";

type SetOpen = Dispatch<SetStateAction<boolean>>;

export interface AppWindowEventsOptions {
  commands: Command[];
  setAiSettingsOpen: SetOpen;
  setPrivacyOpen: SetOpen;
  setTrashOpen: SetOpen;
  setAiDoctorOpen: SetOpen;
  setCommentsPanelOpen: SetOpen;
}

export function useAppWindowEvents({
  commands,
  setAiSettingsOpen,
  setPrivacyOpen,
  setTrashOpen,
  setAiDoctorOpen,
  setCommentsPanelOpen,
}: AppWindowEventsOptions): void {
  // The suggestions panel (and other UIs) re-run a palette command by id.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  useEffect(() => {
    const onRun = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      const find = (list: typeof commands): (typeof commands)[number] | undefined => {
        for (const c of list) {
          if (c.id === id) return c;
          const child = c.children ? find(c.children as typeof commands) : undefined;
          if (child) return child;
        }
        return undefined;
      };
      const cmd = id ? find(commandsRef.current) : undefined;
      if (cmd) void cmd.action();
    };
    window.addEventListener("lumen-run-command", onRun);
    return () => window.removeEventListener("lumen-run-command", onRun);
  }, []);
  useEffect(() => {
    const onOpen = () => setAiSettingsOpen(true);
    window.addEventListener("lumen-open-ai-settings", onOpen);
    return () => window.removeEventListener("lumen-open-ai-settings", onOpen);
  }, [setAiSettingsOpen]);
  useEffect(() => {
    const onOpen = () => setPrivacyOpen(true);
    window.addEventListener("lumen-open-privacy-ledger", onOpen);
    return () => window.removeEventListener("lumen-open-privacy-ledger", onOpen);
  }, [setPrivacyOpen]);
  useEffect(() => {
    const onOpen = () => setTrashOpen(true);
    window.addEventListener("lumen-open-trash", onOpen);
    // Trash older than 30 days is deleted for good, once per start.
    const purge = window.setTimeout(() => {
      void import("../storage/trash").then((m) => (isOPFSAvailable() ? m.purgeExpiredTrash() : 0)).catch(() => 0);
    }, 5000);
    return () => {
      window.removeEventListener("lumen-open-trash", onOpen);
      window.clearTimeout(purge);
    };
  }, [setTrashOpen]);
  useEffect(() => {
    const onOpen = () => setAiDoctorOpen(true);
    window.addEventListener("lumen-open-ai-doctor", onOpen);
    return () => window.removeEventListener("lumen-open-ai-doctor", onOpen);
  }, [setAiDoctorOpen]);
  // Stage 2 of the improvement agent (a small local model proposes suggestions).
  useEffect(() => {
    void import("../agents/modelCritic").then((m) => m.installModelCritic());
  }, []);

  // Comment-anchor click in the editor → window event from
  // commentDecorations.ts. Open the side panel + jump the panel
  // scroll to the matching thread (the panel itself listens for the
  // same event to highlight the right row).
  useEffect(() => {
    const onCommentFocus = () => setCommentsPanelOpen(true);
    window.addEventListener("lumen-comment-focus", onCommentFocus);
    return () => window.removeEventListener("lumen-comment-focus", onCommentFocus);
  }, [setCommentsPanelOpen]);
}
