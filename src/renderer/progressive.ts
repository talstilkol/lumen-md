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
 * Split Markdown into top-level blocks: a new block starts at a non-blank
 * line that follows a blank line, unless that line is inside a fenced
 * code block, a `$$` math block, a `:::` container or the YAML
 * frontmatter. Blank lines stay with the block before them, so the blocks
 * are consecutive substrings: concatenated, they give the input back.
 */
export function splitBlocks(markdown: string): string[] {
  const starts: number[] = [0];
  let fence: string | null = null; // ``` / ~~~ / $$ in force
  let container = 0; // open ::: containers
  let frontmatter = markdown.startsWith("---\n") || markdown.startsWith("---\r\n");
  let prevBlank = false;
  let pos = 0;
  let first = true;
  while (pos < markdown.length) {
    const nl = markdown.indexOf("\n", pos);
    const end = nl === -1 ? markdown.length : nl + 1;
    const line = markdown.slice(pos, end);
    const t = line.trim();
    if (first) {
      first = false;
    } else if (frontmatter) {
      if (t === "---") frontmatter = false;
    } else if (fence) {
      if ((fence === "$$" && t.endsWith("$$")) || (fence !== "$$" && t.startsWith(fence) && t.slice(fence.length).trim() === "")) fence = null;
    } else {
      if (t !== "" && prevBlank && container === 0) starts.push(pos);
      const open = /^(`{3,}|~{3,})/.exec(t);
      if (open) fence = open[1];
      else if (t === "$$" || (t.startsWith("$$") && !t.slice(2).includes("$$"))) fence = "$$";
      else if (/^:{3,}\s*\S/.test(t)) container++;
      else if (/^:{3,}\s*$/.test(t)) container = Math.max(0, container - 1);
    }
    if (pos === 0 && !frontmatter) {
      // The first line may itself open a fence or a container.
      const open = /^(`{3,}|~{3,})/.exec(t);
      if (open) fence = open[1];
      else if (t === "$$" || (t.startsWith("$$") && !t.slice(2).includes("$$"))) fence = "$$";
      else if (/^:{3,}\s*\S/.test(t)) container++;
    }
    prevBlank = t === "" && !fence && !frontmatter;
    pos = end;
  }
  return starts.map((s, i) => markdown.slice(s, starts[i + 1] ?? markdown.length)).filter((b) => b.length > 0);
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
  /**
   * The first slice takes at least this many top-level elements — what the
   * first paint already shows — so the swap never shortens the visible
   * document for a moment.
   */
  minFirstElements?: number;
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

  let first = true;
  const run = (limit: number) => {
    if (cancelled) return;
    const t0 = now();
    if (first && opts.minFirstElements) {
      let seen = 0;
      let end = i;
      while (end < nodes.length && seen < opts.minFirstElements) if (nodes[end++].type === "element") seen++;
      if (end > i) {
        slices.push(toElements(nodes.slice(i, end)));
        i = end;
      }
    }
    first = false;
    // At least one step per run, then as many as fit the budget.
    do {
      if (i >= nodes.length) break;
      const next = Math.min(nodes.length, i + step);
      slices.push(toElements(nodes.slice(i, next)));
      i = next;
    } while (now() - t0 < limit);
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
