/**
 * Viewport-first progressive rendering (plan 8.1 step 4).
 *
 * Two halves. On a cold start the preview paints the first screen of the
 * document synchronously: `firstScreen` cuts the Markdown at a block
 * boundary after enough text to fill a phone screen or two, and that
 * head alone goes through the synchronous pass. When the worker's full
 * tree arrives, `applyInSlices` turns it into React elements a few
 * top-level nodes at a time: the first slice right away, the rest in
 * idle callbacks of under ~30 ms each, so no task on the way to
 * "interactive" is long. Nothing here changes what is rendered, only
 * when each part of it reaches the DOM.
 */
import type { Root as HastRoot, RootContent } from "hast";
import { scheduleIdle } from "../lib/idle";

/** About two phone screens of text. */
export const FIRST_SCREEN_CHARS = 1500;
export const FIRST_SCREEN_BLOCKS = 12;

/**
 * Split Markdown into top-level blocks at blank lines, never inside a
 * fenced code block, a `:::` container or a `$$` math block, and never
 * inside YAML frontmatter. Concatenating the result gives the input back.
 */
export function splitBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null; // the fence marker in force (``` / ~~~ / $$)
  let container = 0; // open ::: containers
  let i = 0;
  // Frontmatter stays one block.
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      blocks.push(lines.slice(0, end + 1).join("\n") + "\n");
      i = end + 1;
    }
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith(fence) && trimmed.slice(fence.length).trim() === "" || (fence === "$$" && trimmed.endsWith("$$"))) fence = null;
      current.push(line);
      continue;
    }
    const fenceOpen = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceOpen) {
      fence = fenceOpen[1];
      current.push(line);
      continue;
    }
    if (trimmed === "$$" || (trimmed.startsWith("$$") && !trimmed.slice(2).includes("$$"))) {
      fence = "$$";
      current.push(line);
      continue;
    }
    if (/^:{3,}\s*\S/.test(trimmed)) container++;
    else if (/^:{3,}\s*$/.test(trimmed)) container = Math.max(0, container - 1);
    if (trimmed === "" && container === 0 && current.length) {
      blocks.push(current.join("\n") + "\n");
      current = [];
      // Keep the blank line itself with the block that follows, as a lead-in.
      let j = i;
      while (j + 1 < lines.length && lines[j + 1].trim() === "") j++;
      blocks[blocks.length - 1] += lines.slice(i + 1, j + 1).map((l) => l + "\n").join("");
      i = j;
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  // split("\n") drops the final newline; put it back on the last block.
  const joined = blocks.join("");
  if (joined !== markdown && joined + "\n" === markdown) blocks[blocks.length - 1] += "\n";
  else if (joined.endsWith("\n") && !markdown.endsWith("\n")) blocks[blocks.length - 1] = blocks[blocks.length - 1].replace(/\n$/, "");
  return blocks;
}

/**
 * The head of the document that fills the first screen or two, and
 * whether anything follows it.
 */
export function firstScreen(markdown: string, limits = { chars: FIRST_SCREEN_CHARS, blocks: FIRST_SCREEN_BLOCKS }): { head: string; partial: boolean } {
  const blocks = splitBlocks(markdown);
  let head = "";
  let n = 0;
  for (const b of blocks) {
    head += b;
    n++;
    if (head.length >= limits.chars || n >= limits.blocks) break;
  }
  return { head, partial: n < blocks.length };
}

export interface SliceOptions {
  /** Time budget per slice, ms (the React commit comes on top; keep it well under 50). */
  budgetMs?: number;
  /** Top-level nodes converted between clock checks. */
  step?: number;
  /** The first slice's budget: what is rendered before the first yield. */
  firstBudgetMs?: number;
}

/**
 * Convert the tree's top-level nodes to React in slices: as many as fit
 * the first budget now, the rest in idle callbacks. `emit` receives the
 * slices so far (the array grows; earlier entries keep their identity)
 * and whether every node is in. Returns a cancel function.
 */
export function applyInSlices<T>(
  tree: HastRoot,
  toElements: (nodes: RootContent[]) => T,
  emit: (slices: T[], done: boolean) => void,
  opts: SliceOptions = {},
): () => void {
  const budget = opts.budgetMs ?? 25;
  const step = opts.step ?? 4;
  const nodes = tree.children;
  const slices: T[] = [];
  let i = 0;
  let cancelled = false;
  let cancelIdle: (() => void) | null = null;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const run = (limit: number) => {
    if (cancelled) return;
    const t0 = now();
    do {
      const next = Math.min(nodes.length, i + step);
      slices.push(toElements(nodes.slice(i, next)));
      i = next;
    } while (i < nodes.length && now() - t0 < limit);
    const done = i >= nodes.length;
    emit([...slices], done);
    if (!done) cancelIdle = scheduleIdle(() => run(budget), 500);
  };
  run(opts.firstBudgetMs ?? budget);
  return () => {
    cancelled = true;
    cancelIdle?.();
  };
}
