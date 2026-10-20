/**
 * The preview of a long document, rendered block by block (plan 8.4).
 *
 * The full pipeline turns the whole document into one React tree; for a
 * 2 MB note that is seconds of main thread on every pause in typing. Here
 * the document is split into top-level blocks (./blocks.ts) and each block
 * goes through the same pipeline on its own. After an edit only the
 * changed blocks are rendered again; the others keep their React element —
 * the same object, so React skips them entirely. Rendering yields to the
 * browser every few milliseconds, so even the first render of a long note
 * never holds a frame.
 *
 * What a block cannot render on its own falls back to the full pipeline
 * (`canRenderInBlocks`): footnotes and reference definitions (they reach
 * across the document) and CriticMarkup. Heading ids are numbered across
 * blocks with the document's slugger, so they match the full render.
 */

import { Fragment, jsx } from "react/jsx-runtime";
import type { ReactElement } from "react";
import { headingSlugger } from "../lib/slug";
import { mayContainCriticMarkup } from "../editor/suggesting";
import { BlockTracker } from "./blocks";
import { prepareCriticMarkup } from "./criticMarkup";
import { buildBlockProcessor, pipelineOptions, type BlockSlugs } from "./pipeline";

/** Footnotes, reference definitions and CriticMarkup need the whole document. */
export function canRenderInBlocks(markdown: string): boolean {
  // Examples inside code (`[^1]` in a fence, a `[label]: x` code span) are not Markdown.
  const text = withoutCode(markdown);
  if (mayContainCriticMarkup(text)) return false;
  if (/\[\^[^\]\s]+\]/.test(text)) return false;
  return !/^ {0,3}\[[^\]]+\]:/m.test(text);
}

/** `markdown` with fenced code blocks and code spans removed (an approximation that only ever removes code). */
export function withoutCode(markdown: string): string {
  if (!markdown.includes("`") && !markdown.includes("~~~")) return markdown;
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}[`~]+[ \t]*\r?$/.test(line)) fence = null;
      continue;
    }
    if (m && !(m[1][0] === "`" && line.slice(line.indexOf(m[1]) + m[1].length).includes("`"))) {
      fence = m[1];
      continue;
    }
    out.push(line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, ""));
  }
  return out.join("\n");
}

interface Rendered {
  text: string;
  /** React key: stable for as long as this block is kept. */
  key: string;
  element: ReactElement;
  /** The heading texts this block gave to the slugger, in order. */
  slugTexts: string[];
  ids: string[];
}

type Processor = Awaited<ReturnType<typeof buildBlockProcessor>>;
type Slugger = ReturnType<typeof headingSlugger>;

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class IncrementalPreview {
  private readonly tracker = new BlockTracker({ preview: true });
  private values: (Rendered | null)[] = [];
  private variant = "";
  private processor: Processor | null = null;
  private nextKey = 0;
  /** The slugger the block being rendered numbers its headings with. */
  private slugs: { slugger: Slugger; texts: string[]; ids: string[] } | null = null;
  private running: Promise<unknown> = Promise.resolve();
  /** Blocks rendered since this preview was created (a test counter). */
  rendered = 0;

  private readonly blockSlugs: BlockSlugs = {
    slug: (text) => {
      const s = this.slugs!;
      const id = s.slugger.slug(text);
      s.texts.push(text);
      s.ids.push(id);
      return id;
    },
  };

  /**
   * The preview of `markdown`, or null when `isStale()` turned true while
   * rendering (a newer text is on its way). One render at a time.
   */
  render(markdown: string, isDark: () => boolean, isStale: () => boolean = () => false): Promise<ReactElement | null> {
    const run = this.running.then(() => this.renderNow(markdown, isDark, isStale));
    this.running = run.catch(() => undefined);
    return run;
  }

  private async renderNow(markdown: string, isDark: () => boolean, isStale: () => boolean): Promise<ReactElement | null> {
    if (isStale()) return null;
    const opts = pipelineOptions(markdown);
    const variant = `${opts.raw ? 1 : 0}${opts.math ? 1 : 0}${isDark() ? 1 : 0}`;
    if (variant !== this.variant || !this.processor) {
      // Another pipeline (inline HTML / math appeared) or theme: start over.
      this.processor = await buildBlockProcessor(isDark, opts, this.blockSlugs);
      this.variant = variant;
      this.tracker.reset();
      this.values = [];
    }
    const proc = this.processor;
    const u = this.tracker.update(markdown);
    const reusable = new Map<string, Rendered>();
    for (let k = u.head; k < u.oldTail && k < this.values.length; k++) {
      const v = this.values[k];
      if (v) reusable.set(v.text, v);
    }
    const middle = u.blocks.slice(u.head, u.tail).map((b) => {
      const v = reusable.get(markdown.slice(b.start, b.end));
      if (v) reusable.delete(v.text);
      return v ?? null;
    });
    const values = this.values.slice(0, u.head).concat(middle, this.values.slice(u.oldTail));
    this.values = values;

    const running = headingSlugger();
    const allTexts: string[] = [];
    let sliceStart = now();
    for (let i = 0; i < u.blocks.length; i++) {
      let v = values[i];
      if (v) {
        // Kept: still valid if its headings get the same ids here.
        const ids = v.slugTexts.map((t) => running.slug(t));
        if (ids.some((id, k) => id !== v!.ids[k])) {
          // A heading above it changed how its repeats are numbered.
          const seeded = headingSlugger();
          for (const t of allTexts) seeded.slug(t);
          v = await this.renderBlock(proc, v.text, seeded);
          values[i] = v;
        }
      } else {
        const b = u.blocks[i];
        v = await this.renderBlock(proc, markdown.slice(b.start, b.end), running);
        values[i] = v;
      }
      allTexts.push(...v.slugTexts);
      if (now() - sliceStart > 8) {
        await yieldToBrowser();
        if (isStale()) return null;
        sliceStart = now();
      }
    }
    return jsx(Fragment, { children: values.map((v) => v!.element) });
  }

  private async renderBlock(proc: Processor, text: string, slugger: Slugger): Promise<Rendered> {
    const slugs = { slugger, texts: [] as string[], ids: [] as string[] };
    this.slugs = slugs;
    let result: ReactElement;
    try {
      const file = await proc.process(prepareCriticMarkup(text));
      result = file.result as ReactElement;
    } finally {
      this.slugs = null;
    }
    this.rendered++;
    const key = `b${++this.nextKey}`;
    return { text, key, element: jsx(Fragment, { children: result }, key), slugTexts: slugs.texts, ids: slugs.ids };
  }
}
