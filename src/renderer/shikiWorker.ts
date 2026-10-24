/**
 * The render worker's Shiki (plan 8.1 step 3): shiki/core with the same
 * Oniguruma engine and themes as the main thread's bundle, the six
 * preloaded grammars bundled, and every other grammar fetched as JSON from
 * public/shiki/langs/ (scripts/copy-shiki-grammars.mjs, which also stages
 * the engine's wasm) — one bundled worker script cannot `import()` a
 * language chunk without inlining all of them. Highlighting is
 * token-for-token what the main thread produced.
 *
 * The loaders are swappable so tests can run this in Node (no fetch of
 * same-origin assets there).
 */
import type { Root } from "hast";
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import githubDark from "@shikijs/themes/github-dark-default";
import githubLight from "@shikijs/themes/github-light-default";
import javascript from "@shikijs/langs/javascript";
import typescript from "@shikijs/langs/typescript";
import json from "@shikijs/langs/json";
import markdown from "@shikijs/langs/markdown";
import bash from "@shikijs/langs/bash";
import python from "@shikijs/langs/python";
import { PRELOADED_LANGS, type Highlighter } from "./shiki";

export interface ShikiLoaders {
  /** The Oniguruma WebAssembly (shiki/onig.wasm, staged as public/shiki/onig.wasm). */
  wasm: () => Promise<Response | ArrayBuffer | Uint8Array>;
  /** The grammar names a language or alias needs, in order (null: unknown language). */
  grammarsFor: (lang: string) => Promise<string[] | null>;
  /** One grammar by name (null: not available). */
  grammar: (name: string) => Promise<LanguageRegistration | null>;
}

const base = (): string => (typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/");

const fetchJson = async <T>(path: string): Promise<T | null> => {
  const res = await fetch(`${base()}shiki/langs/${path}`);
  return res.ok ? ((await res.json()) as T) : null;
};
const fetchWasm = async (): Promise<Response> => {
  const res = await fetch(`${base()}shiki/onig.wasm`);
  if (!res.ok) throw new Error(`shiki/onig.wasm: HTTP ${res.status}`);
  return res;
};

let indexPromise: Promise<Record<string, string[]>> | null = null;
const fetchIndex = (): Promise<Record<string, string[]>> => {
  indexPromise ??= fetchJson<Record<string, string[]>>("index.json").then((i) => i ?? {});
  indexPromise.catch(() => {
    indexPromise = null;
  });
  return indexPromise;
};

let loaders: ShikiLoaders = {
  wasm: fetchWasm,
  grammarsFor: async (lang) => (await fetchIndex())[lang] ?? null,
  grammar: (name) => fetchJson<LanguageRegistration>(`${name}.json`),
};

/** For tests and other hosts: where the wasm and the grammars come from. */
export function setShikiLoaders(l: Partial<ShikiLoaders>): void {
  loaders = { ...loaders, ...l };
  corePromise = null;
  indexPromise = null;
  loaded.clear();
  inFlight.clear();
}

let corePromise: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

function core(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = createHighlighterCore({
      themes: [githubDark, githubLight],
      langs: [javascript, typescript, json, markdown, bash, python],
      engine: createOnigurumaEngine(() => loaders.wasm()),
    }).then((hl) => {
      for (const l of PRELOADED_LANGS) loaded.add(l);
      return hl;
    });
    corePromise.catch(() => {
      corePromise = null;
    });
  }
  return corePromise;
}

async function ensureLang(lang: string): Promise<string> {
  if (!lang || lang === "text") return "text";
  if (loaded.has(lang)) return lang;
  let job = inFlight.get(lang);
  if (!job) {
    job = (async () => {
      try {
        const hl = await core();
        const names = await loaders.grammarsFor(lang);
        if (!names) return;
        const regs = await Promise.all(names.map((n) => loaders.grammar(n)));
        if (regs.some((r) => !r)) return;
        await hl.loadLanguage(...(regs as LanguageRegistration[]));
        loaded.add(lang);
      } catch {
        /* unavailable — plain text */
      }
    })();
    inFlight.set(lang, job);
  }
  await job;
  return loaded.has(lang) ? lang : "text";
}

/** The worker's Highlighter for rehypeShikiWith(). */
export const workerHighlighter = async (): Promise<Highlighter> => {
  const hl = await core();
  return { codeToHast: (src, o) => hl.codeToHast(src, o as unknown as Parameters<HighlighterCore["codeToHast"]>[1]) as Root, ensureLang };
};
