/**
 * Hebrew names for the PII redactor (plan 2.6): DictaBERT-NER (CC BY 4.0,
 * appendix 19), converted to ONNX by scripts/models/convert.mjs (plan 6.0).
 *
 * Only a model that is already on this device is used: a cloud request
 * never starts a download. Until the host of the converted models is
 * chosen (15.9, CONVERTED_MODELS_BASE is null) there is nothing to load.
 *
 * The fallback (audit W10.C23): Ollama on this machine, asked for the names
 * in the text as JSON and held to them (every name must be in the text).
 * Without either, `namesEngine` says "none", and the redactor's preview
 * says that names are not hidden — it never lets the user think they are.
 * The engine is chosen by the text's language, not by what is cached
 * (audit r3): English text uses bert-base-NER, Hebrew DictaBERT-NER, and a
 * text whose language no engine here reads (another script, or Latin with
 * no capitalised word) gets no finder (and the warning).
 */
import { alignNer, type NerFn } from "./pii";
import { CONVERTED_MODELS_BASE, loadConvertedRegistry } from "./convertedModels";

export const NER_MODEL_ID = "dictabert-ner";
export const NER_MODEL_ID_EN = "bert-base-ner";

/**
 * Every entity DictaBERT-NER finds (W11.H11), for unlinked mentions: the
 * same cached-only rule as the redactor. Null when the model is not on this
 * device.
 */
export async function entitiesIfCached(base: string | null = CONVERTED_MODELS_BASE): Promise<((text: string) => Promise<import("./ner/entities").TextEntity[]>) | null> {
  const model = await cachedModel(base);
  if (!model) return null;
  return async (text) => {
    const [{ nerLocal }, { alignEntities }] = await Promise.all([import("./transformersEngine"), import("./ner/entities")]);
    const [tokens] = await nerLocal([text], model);
    return alignEntities(text, tokens ?? []);
  };
}

/** The model's folder on the host when its int8 (q8) files are already cached, else null. */
async function cachedModel(base: string | null, id: string = NER_MODEL_ID): Promise<string | null> {
  if (!base) return null;
  const entry = (await loadConvertedRegistry()).get(id);
  if (!entry || typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  const { isModelCached } = await import("./modelCache");
  const root = (await navigator.storage.getDirectory()) as unknown as Parameters<typeof isModelCached>[0];
  if (!(await isModelCached(root, entry, "q8"))) return null;
  return `${base.endsWith("/") ? base : `${base}/`}${id}`;
}

/** The name finder when DictaBERT-NER is cached, else null. */
export async function nerIfCached(base: string | null = CONVERTED_MODELS_BASE, id: string = NER_MODEL_ID): Promise<NerFn | null> {
  const model = await cachedModel(base, id);
  if (!model) return null;
  return async (text) => {
    const { nerLocal } = await import("./transformersEngine");
    const [tokens] = await nerLocal([text], model);
    return alignNer(text, tokens ?? []);
  };
}

/* ── The fallback: Ollama on this machine ───────────────────────────── */

/** Asks a local model for the person names in a text (JSON `{"names": [...]}`); rejects when none runs. */
export type NamesAsk = (text: string, signal?: AbortSignal) => Promise<string[]>;

const ollamaAsk: NamesAsk = async (text, signal) => {
  const [{ runAgentOrThrow }, { piiNamesAgent }] = await Promise.all([import("../agents/runtime"), import("../agents/defs/piiNames")]);
  return (await runAgentOrThrow(piiNamesAgent, { text }, { signal })).names;
};

/** Every occurrence of every name the model gave, as PERSON spans (a name not in the text is ignored). */
export function spansOf(text: string, names: readonly string[]): Array<{ start: number; end: number; type: "PERSON" }> {
  const out: Array<{ start: number; end: number; type: "PERSON" }> = [];
  for (const n of [...new Set(names.map((x) => x.trim()).filter((x) => x.length > 1))].sort((a, b) => b.length - a.length)) {
    for (let at = text.indexOf(n); at >= 0; at = text.indexOf(n, at + n.length)) {
      if (!out.some((o) => at < o.end && at + n.length > o.start)) out.push({ start: at, end: at + n.length, type: "PERSON" });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The name finder over a local model's answer. */
export function ollamaNamesFinder(ask: NamesAsk = ollamaAsk): NerFn {
  return async (text, signal) => spansOf(text, await ask(text, signal));
}

export type NamesEngine = "dictabert" | "bert-base-ner" | "ollama" | "none";
/** "other": a script no engine here reads (Arabic, Cyrillic, …), or Latin with no case to go by. */
export type NamesLanguage = "he" | "en" | "other";

/** Thrown by the finder for a text whose language no engine on this device covers. */
export class NamesUnsupportedError extends Error {
  constructor(readonly languages: NamesLanguage[]) {
    super(`No name finder on this device for ${languages.map((l) => (l === "other" ? "other-script or all-caps/lowercase" : l)).join(", ")} text`);
    this.name = "NamesUnsupportedError";
  }
}

const OTHER_SCRIPT = /(?:(?!\p{Script=Hebrew}|\p{Script=Latin})\p{L}){2,}/u;

/**
 * The languages whose names a text may hold (audit r3, W10.C23; review 12,
 * H2), outside links, addresses and inline code: Hebrew when it has a Hebrew
 * word; English when it has a Latin word of 2+ letters; "other" when it has
 * a word in any other script, or Latin words none of which is capitalised
 * (all-caps or all-lowercase text: the cased English model can't tell a
 * name there). No engine covers "other", so such a text is never claimed to
 * have its names hidden. Fail closed: a mixed text needs every language.
 */
export function namesLanguages(text: string): NamesLanguage[] {
  const out: NamesLanguage[] = [];
  const plain = text.replace(/`[^`\n]*`/g, " ").replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").replace(/\S+@\S+/g, " ");
  if (/\p{Script=Hebrew}{2,}/u.test(plain)) out.push("he");
  const latin = plain.match(/\p{Script=Latin}{2,}/gu) ?? [];
  if (latin.length) out.push("en");
  const caseless = latin.length > 0 && !latin.some((w) => /^\p{Lu}\p{Ll}/u.test(w));
  if (caseless || OTHER_SCRIPT.test(plain)) out.push("other");
  return out;
}

/** What each engine reads: DictaBERT is Hebrew, bert-base-NER English, a local Ollama model both. */
const COVERS: Record<Exclude<NamesEngine, "none">, readonly NamesLanguage[]> = { dictabert: ["he"], "bert-base-ner": ["en"], ollama: ["he", "en"] };

/**
 * The name finder this device has, chosen by each text's language (audit r3,
 * W10.C23): a cached converted model for that language (DictaBERT-NER for
 * Hebrew, bert-base-NER for English), else Ollama on this machine. A text in
 * a language no engine here covers gets no finder: the call throws
 * NamesUnsupportedError, the redactor keeps patterns only and its preview
 * says names are not hidden. Nothing is claimed for a language it can't read.
 * `engine` is the best engine found, "none" when there is none at all; with
 * a cached model, Ollama is asked for only when a text needs it.
 */
export async function namesEngine(deps: { cached?: (id: string) => Promise<NerFn | null>; ollamaUp?: () => Promise<boolean>; ask?: NamesAsk } = {}): Promise<{ engine: NamesEngine; ner: NerFn | null }> {
  const cached = deps.cached ?? ((id: string) => nerIfCached(CONVERTED_MODELS_BASE, id));
  const up = deps.ollamaUp ?? (async () => !!(await (await import("../agents/executors")).pickExecutor(["ollama"])).executor);
  const engines: Array<[Exclude<NamesEngine, "none">, NerFn]> = [];
  const he = await cached(NER_MODEL_ID).catch(() => null);
  if (he) engines.push(["dictabert", he]);
  const en = await cached(NER_MODEL_ID_EN).catch(() => null);
  if (en) engines.push(["bert-base-ner", en]);
  let ollama: Promise<boolean> | null = null;
  const withOllama = async () => {
    ollama ??= up().catch(() => false);
    if ((await ollama) && !engines.some(([id]) => id === "ollama")) engines.push(["ollama", ollamaNamesFinder(deps.ask)]);
  };
  if (!engines.length) {
    await withOllama();
    if (!engines.length) return { engine: "none", ner: null };
  }
  const engine = engines[0][0];
  const covered = (l: NamesLanguage) => engines.some(([id]) => COVERS[id].includes(l));
  const ner: NerFn = async (text, signal) => {
    const langs = namesLanguages(text);
    if (!langs.every(covered)) await withOllama();
    const missing = langs.filter((l) => !covered(l));
    if (missing.length) throw new NamesUnsupportedError(missing);
    // One engine per language, the first that covers it; an engine that covers several runs once.
    const picked = new Set<NerFn>();
    for (const l of langs) picked.add(engines.find(([id]) => COVERS[id].includes(l))![1]);
    const spans: Awaited<ReturnType<NerFn>> = [];
    for (const f of picked) for (const s of await f(text, signal)) if (!spans.some((o) => s.start < o.end && s.end > o.start)) spans.push(s);
    return spans.sort((a, b) => a.start - b.start);
  };
  return { engine, ner };
}
