/**
 * CodeMirror extension that runs `lintMarkdown` on the doc and surfaces
 * findings as a count badge + small underline decorations.
 *
 * Live updates on every doc change (debounced 250 ms). The actual
 * `lintMarkdown` engine lives in `src/lint/markdownLint.ts`; this file is
 * pure UI plumbing.
 *
 * Decorations are kept lightweight — a wavy underline coloured by
 * severity (info = grey, warning = amber, error = red). Hovering shows
 * the rule id + message via a `title` attribute on the line gutter.
 */

import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { lintMarkdown, type LintFinding } from "../lint/markdownLint";

const SEVERITY_COLOR: Record<LintFinding["severity"], string> = {
  info: "hsl(220 14% 60%)",
  warning: "hsl(40 90% 60%)",
  error: "hsl(0 80% 65%)",
};

function decorationsFor(view: EditorView, findings: LintFinding[]): DecorationSet {
  const ranges = findings
    .filter((f) => f.line <= view.state.doc.lines)
    .map((f) => {
      const line = view.state.doc.line(f.line);
      const from = line.from + Math.max(0, (f.column ?? 1) - 1);
      const to = Math.min(line.to, from + 8); // short underline so we don't shout
      return Decoration.mark({
        class: `cm-lint-${f.severity}`,
        attributes: {
          title: `${f.rule}: ${f.message}`,
          style: `text-decoration: underline wavy ${SEVERITY_COLOR[f.severity]}; text-decoration-skip-ink: none`,
        },
      }).range(from, Math.max(from + 1, to));
    })
    .sort((a, b) => a.from - b.from);
  return Decoration.set(ranges, true);
}

export interface LintExtensionOptions {
  /** Workspace note titles for cross-link validation (LUMEN001). */
  getWorkspaceTitles?: () => Set<string>;
  /** Pushed when the finding count changes — wire to a status-bar pill. */
  onFindings?: (findings: LintFinding[]) => void;
}

export function markdownLintExtension(opts: LintExtensionOptions = {}): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private findings: LintFinding[] = [];
      private timer: number | null = null;

      constructor(view: EditorView) {
        this.decorations = Decoration.none;
        // Defer the initial run — calling `view.dispatch` synchronously
        // from a ViewPlugin constructor is forbidden ("update in progress").
        // setTimeout(0) lands us cleanly outside CodeMirror's update cycle.
        this.timer = window.setTimeout(() => {
          this.timer = null;
          this.run(view);
        }, 0);
      }

      update(u: ViewUpdate) {
        if (u.docChanged) this.schedule(u.view);
      }

      schedule(view: EditorView): void {
        if (this.timer != null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = null;
          this.run(view);
        }, 250);
      }

      run(view: EditorView): void {
        const titles = opts.getWorkspaceTitles?.();
        this.findings = lintMarkdown(view.state.doc.toString(), {
          workspaceTitles: titles,
        });
        this.decorations = decorationsFor(view, this.findings);
        opts.onFindings?.(this.findings);
        // Force a redraw so the new decoration set lands. Always called
        // from a setTimeout callback, so we're outside the update cycle.
        view.dispatch({});
      }

      destroy(): void {
        if (this.timer != null) window.clearTimeout(this.timer);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
