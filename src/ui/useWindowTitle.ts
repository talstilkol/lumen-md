/**
 * The window title follows the open note (plan W13.H4): "‹name› — Lumen",
 * with the name isolated (lib/isolate) so "פתק (2).md" keeps its brackets in
 * the browser tab, the task switcher and the Tauri window, whatever the
 * interface language. The dirty dot is the editor's own; the title stays
 * the name.
 */
import { useEffect } from "react";
import { windowTitle } from "../lib/isolate";

export function useWindowTitle(noteName: string | null | undefined): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = windowTitle(noteName);
  }, [noteName]);
}
