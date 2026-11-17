/**
 * The clip-interpreter eval's run (plan W2.14): clip each golden page with
 * the given interpreter (the real local model in clipInterpreter.eval.ts, a
 * stand-in in the unit test), time the whole clip, collect each field, and
 * record every request made while clipping.
 */
import { buildClip, parsePayload } from "../../../src/research/clipV2";
import type { InterpretFn } from "../../../src/research/clipInterpreter";
import type { FieldExpectation, PageResult } from "./clipInterpreterScore";

export interface GoldenPage {
  url: string;
  html: string;
  transcript?: string;
  template: string;
  fields: Record<string, string>;
  model: Record<string, FieldExpectation>;
}

export interface ClipRun {
  results: PageResult[];
  /** Every URL fetched while the pages were clipped. */
  requests: string[];
  /** Pages whose interpreter did not answer (unavailable / failed): their prompt fields count as wrong. */
  unanswered: string[];
}

/** The note's front matter as name → value (JSON string literals decoded). */
export function frontmatterOf(md: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = /^([\w-]+): (.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v) as string;
      } catch {
        // why: a quoted value that is not a JSON string literal is kept as written
      }
    }
    out[m[1]] = v;
  }
  return out;
}

export async function runClipEval(pages: GoldenPage[], ask: InterpretFn, opts: { signal?: AbortSignal; now?: () => number; date?: Date } = {}): Promise<ClipRun> {
  const now = opts.now ?? (() => performance.now());
  const requests: string[] = [];
  const realFetch = globalThis.fetch;
  // Every request made while clipping is recorded (W2.14: 0 off the device), then passed on.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return realFetch(input, init);
  }) as typeof fetch;
  const results: PageResult[] = [];
  const unanswered: string[] = [];
  try {
    for (const p of pages) {
      opts.signal?.throwIfAborted();
      const payload = parsePayload({ url: p.url, html: p.html, transcript: p.transcript });
      if (!payload) throw new Error(`${p.url}: not a valid clip payload`);
      const t0 = now();
      const c = await buildClip(payload, { library: "Library", interpret: ask, signal: opts.signal, date: opts.date ?? new Date("2026-11-10T00:00:00Z") });
      const ms = now() - t0;
      if (c.interpreter !== "local") unanswered.push(`${p.url} (${c.interpreter})`);
      const fm = frontmatterOf(c.markdown);
      const page: PageResult["page"] = {};
      for (const [k, v] of Object.entries(p.fields)) if (!(k in p.model)) page[k] = [fm[k] ?? "", v];
      const model: PageResult["model"] = {};
      for (const [k, e] of Object.entries(p.model)) model[k] = [fm[k] ?? "", e];
      results.push({ url: p.url, ms, page, model });
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  return { results, requests, unanswered };
}
