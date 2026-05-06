/**
 * Regression test for ADR-001 / Bug #1.
 *
 * `markdownLintExtension`'s `ViewPlugin` constructor used to call
 * `view.dispatch({})` synchronously, which CodeMirror forbids ("Calls
 * to EditorView.update are not allowed while an update is in progress").
 * Mounting the editor produced a flood of `[error] CodeMirror plugin
 * crashed` logs, and the first lint pass didn't draw until the user
 * typed.
 *
 * The fix defers the initial run via `setTimeout(0)` so the dispatch
 * lands cleanly outside CM6's update cycle. This test pins that
 * behavior — the dispatch must NOT have happened by the time the
 * EditorView constructor returns; it should happen on the next
 * macrotask.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownLintExtension } from "../editor/lintExtension";

describe("markdownLintExtension mount lifecycle", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("does not log a CodeMirror plugin crash during initial mount", () => {
    // Before the fix, calling `view.dispatch({})` synchronously inside
    // the ViewPlugin constructor caused CM6 to throw and log
    // "CodeMirror plugin crashed". The error was caught internally so
    // the editor mounted, but the console was flooded — so checking
    // `.not.toThrow()` is vacuous. Spy on console.error instead.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = new EditorView({
        state: EditorState.create({
          doc: "# hello\n",
          extensions: [markdownLintExtension()],
        }),
        parent: host,
      });
      const crashes = errorSpy.mock.calls
        .flat()
        .map((c) => String(c))
        .filter((s) => /CodeMirror plugin crashed/i.test(s));
      expect(crashes).toEqual([]);
      view.destroy();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("schedules the initial lint run on a macrotask, not synchronously", async () => {
    vi.useFakeTimers();
    try {
      const view = new EditorView({
        state: EditorState.create({
          doc: "# hello\n",
          extensions: [markdownLintExtension()],
        }),
        parent: host,
      });

      // Spy after construction so we don't intercept the constructor itself.
      const dispatchSpy = vi.spyOn(view, "dispatch");

      // Synchronous read: nothing dispatched yet.
      expect(dispatchSpy).not.toHaveBeenCalled();

      // Advance the timer that schedules the deferred initial run.
      vi.advanceTimersByTime(1);

      // Now the lint pass has run and dispatched a redraw.
      expect(dispatchSpy).toHaveBeenCalled();
      view.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
