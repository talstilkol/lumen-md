/**
 * Editor tools — the open document and the selection, as the runtime
 * received them from the command (not re-read from disk, so unsaved edits
 * count).
 */

import { defineTool, optionalNumber } from "./define";

export const getDocumentTool = defineTool<{ maxChars?: number }, { path: string | null; content: string; truncated: boolean; chars: number }>({
  name: "get_document",
  description: "The full text of the document the user is editing (including unsaved changes).",
  parameters: { type: "object", properties: { maxChars: { type: "number" } } },
  run: async (args, ctx) => {
    const content = ctx.document ?? "";
    const max = Math.max(200, optionalNumber(args, "maxChars", 24_000));
    return { path: ctx.path ?? null, content: content.slice(0, max), truncated: content.length > max, chars: content.length };
  },
});

export const getSelectionTool = defineTool<Record<string, never>, { selection: string; empty: boolean }>({
  name: "get_selection",
  description: "The text the user selected in the editor (empty when nothing is selected).",
  parameters: { type: "object", properties: {} },
  run: async (_args, ctx) => {
    const selection = ctx.selection ?? "";
    return { selection, empty: selection.length === 0 };
  },
});

export const getHeadingsTool = defineTool<Record<string, never>, { headings: Array<{ level: number; text: string; line: number }> }>({
  name: "get_headings",
  description: "The markdown headings of the open document with their levels and line numbers.",
  parameters: { type: "object", properties: {} },
  run: async (_args, ctx) => {
    const lines = (ctx.document ?? "").split(/\r?\n/);
    const headings: Array<{ level: number; text: string; line: number }> = [];
    let inFence = false;
    lines.forEach((ln, i) => {
      if (/^\s*(```|~~~)/.test(ln)) inFence = !inFence;
      if (inFence) return;
      const m = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (m) headings.push({ level: m[1].length, text: m[2], line: i + 1 });
    });
    return { headings };
  },
});

export const EDITOR_TOOLS = [getDocumentTool, getSelectionTool, getHeadingsTool];
