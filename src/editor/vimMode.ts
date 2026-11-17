/**
 * Vim mode for the source editor (plan W13.E1), on @replit/codemirror-vim
 * (MIT), loaded only when the `vimEnabled` setting is on — its own chunk.
 *
 * What Lumen adds on top of the package:
 *   - `h` / `l` move visually in a right-to-left line (Vim's 'rightleft'),
 *     `w` / `b` / `e` move in reading order, and a letter with its niqqud is
 *     one cell (vimMotions.ts);
 *   - `:w` saves, `:q` closes the tab, `:wq` / `:x` both;
 *   - Esc while an AI request runs cancels the request and leaves the mode
 *     alone (insert stays insert) — the second Esc leaves insert mode.
 */
import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { aiBusy, cancelAllAi, escapeCancelledAi } from "../ai/aiAbort";
import { lineIsRtl, linesOf, motionLeft, motionRight, wordBackward, wordEnd, wordForward, type LineSource, type Pos } from "./vimMotions";

/**
 * Esc first cancels running AI work (the global Esc handler, aiAbort.ts,
 * marks the press it used); only an Esc that cancelled nothing reaches Vim.
 * Highest precedence, before the Vim extension in the list.
 */
export function aiEscapeGuard(): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(e) {
        if (e.key !== "Escape") return false;
        if (escapeCancelledAi(e) || (aiBusy() && cancelAllAi() > 0)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return true;
        }
        return false;
      },
    }),
  );
}

/** What `:w` and `:q` do (App listens for these). */
export const VIM_EX = {
  write: () => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "file.save" } })),
  quit: () => window.dispatchEvent(new CustomEvent("lumen-vim-quit")),
};

interface VimCm {
  getLine(n: number): string;
  lineCount(): number;
}
type VimApi = {
  defineMotion(name: string, fn: (cm: VimCm, head: Pos, args: { repeat?: number; forward?: boolean }, vim: unknown, input?: { operator?: string }) => Pos): void;
  mapCommand(keys: string, type: string, name: string, args?: Record<string, unknown>, extra?: Record<string, unknown>): void;
  defineEx(name: string, prefix: string, fn: () => void): void;
};

const source = (cm: VimCm): LineSource => ({ lineCount: () => cm.lineCount(), getLine: (n) => cm.getLine(n) });

let defined = false;
/** Teach the package Lumen's motions and ex commands (once). */
export function defineLumenVim(Vim: VimApi, mkPos: (line: number, ch: number) => Pos = (line, ch) => ({ line, ch })): void {
  if (defined) return;
  defined = true;
  Vim.defineMotion("lumenLeft", (cm, head, a) => mkPos(head.line, motionLeft(cm.getLine(head.line), head.ch, a.repeat ?? 1)));
  Vim.defineMotion("lumenRight", (cm, head, a) => mkPos(head.line, motionRight(cm.getLine(head.line), head.ch, a.repeat ?? 1)));
  Vim.defineMotion("lumenWordForward", (cm, head, a, _vim, input) => {
    // `cw` changes to the end of the word, as in Vim.
    if (input?.operator === "change") {
      const e = wordEnd(source(cm), { line: head.line, ch: Math.max(0, head.ch - 1) }, a.repeat ?? 1);
      return mkPos(e.line, e.ch + 1);
    }
    const p = wordForward(source(cm), head, a.repeat ?? 1);
    return mkPos(p.line, p.ch);
  });
  Vim.defineMotion("lumenWordBackward", (cm, head, a) => {
    const p = wordBackward(source(cm), head, a.repeat ?? 1);
    return mkPos(p.line, p.ch);
  });
  Vim.defineMotion("lumenWordEnd", (cm, head, a) => {
    const p = wordEnd(source(cm), head, a.repeat ?? 1);
    return mkPos(p.line, p.ch);
  });
  Vim.mapCommand("h", "motion", "lumenLeft", {});
  Vim.mapCommand("l", "motion", "lumenRight", {});
  Vim.mapCommand("<Left>", "motion", "lumenLeft", {});
  Vim.mapCommand("<Right>", "motion", "lumenRight", {});
  Vim.mapCommand("w", "motion", "lumenWordForward", {});
  Vim.mapCommand("b", "motion", "lumenWordBackward", {});
  Vim.mapCommand("e", "motion", "lumenWordEnd", {}, { motionArgs: { inclusive: true } });
  Vim.defineEx("write", "w", VIM_EX.write);
  Vim.defineEx("quit", "q", VIM_EX.quit);
  Vim.defineEx("wq", "wq", () => {
    VIM_EX.write();
    VIM_EX.quit();
  });
  Vim.defineEx("xit", "x", () => {
    VIM_EX.write();
    VIM_EX.quit();
  });
}

/** The Vim extension with Lumen's additions; the package loads here (its own chunk). */
export async function loadVimMode(): Promise<Extension> {
  const m = (await import("@replit/codemirror-vim")) as unknown as { vim: () => Extension; Vim: VimApi; CodeMirror?: { Pos?: (l: number, c: number) => Pos } };
  const Pos = m.CodeMirror?.Pos;
  defineLumenVim(m.Vim, Pos ? (l, c) => Pos(l, c) : undefined);
  return [aiEscapeGuard(), m.vim()];
}

/** For the tests: the motions on a string. */
export const __motions = { lineIsRtl, linesOf };
