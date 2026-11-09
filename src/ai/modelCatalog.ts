/**
 * Local models for Hebrew (MASTER_PLAN v3, T27).
 *
 * Which Ollama models to suggest, and in which order, when the user's
 * notes are in Hebrew. The ranking is from the models' published language
 * coverage, not from our own measurement: `measured` stays null until a
 * report from `npm run eval:agents` on real hardware is recorded here
 * (MASTER_PLAN §8, step 3a). The in-browser catalog lives in
 * modelManager.ts; its `multilingual` flag is used the same way.
 */

export type HebrewSupport = "strong" | "good" | "basic" | "none";

export interface OllamaCatalogEntry {
  /** `ollama pull` name. */
  name: string;
  label: string;
  /** Billions of parameters. */
  params: number;
  /** RAM to run it comfortably (q4), GB. */
  ramGB: number;
  hebrew: HebrewSupport;
  tools: boolean;
  /** Hebrew eval score 0–1 from a real run, when there is one. */
  measured: number | null;
  note?: string;
}

export const OLLAMA_CATALOG: OllamaCatalogEntry[] = [
  { name: "aya-expanse:8b", label: "Aya Expanse 8B", params: 8, ramGB: 8, hebrew: "strong", tools: false, measured: null, note: "Cohere; Hebrew is one of its 23 training languages" },
  { name: "gemma3:12b", label: "Gemma 3 12B", params: 12, ramGB: 12, hebrew: "strong", tools: false, measured: null, note: "140+ languages; best quality that fits 16 GB" },
  { name: "qwen3:8b", label: "Qwen3 8B", params: 8, ramGB: 8, hebrew: "good", tools: true, measured: null, note: "119 languages, tool calling" },
  { name: "qwen2.5:7b", label: "Qwen2.5 7B", params: 7.6, ramGB: 8, hebrew: "good", tools: true, measured: null, note: "the default: tool calling, decent Hebrew" },
  { name: "gemma3:4b", label: "Gemma 3 4B", params: 4, ramGB: 5, hebrew: "good", tools: false, measured: null, note: "for 8 GB machines" },
  { name: "llama3.1:8b", label: "Llama 3.1 8B", params: 8, ramGB: 8, hebrew: "basic", tools: true, measured: null },
  { name: "llama3.2:3b", label: "Llama 3.2 3B", params: 3.2, ramGB: 4, hebrew: "basic", tools: true, measured: null },
];

const RANK: Record<HebrewSupport, number> = { strong: 3, good: 2, basic: 1, none: 0 };

/** How well a (possibly tagged) installed model name handles Hebrew. */
export function hebrewSupportOf(name: string): HebrewSupport | null {
  const base = name.replace(/:latest$/, "");
  const exact = OLLAMA_CATALOG.find((e) => e.name === base);
  if (exact) return exact.hebrew;
  const family = base.split(":")[0];
  const fam = OLLAMA_CATALOG.filter((e) => e.name.split(":")[0] === family);
  if (fam.length) return fam.reduce((b, e) => (RANK[e.hebrew] > RANK[b.hebrew] ? e : b)).hebrew;
  if (/aya|dictalm|hebrew/i.test(base)) return "strong";
  return null;
}

/**
 * The model to suggest pulling. For Hebrew notes: the best Hebrew model
 * that fits the RAM (measured score first when there is one); otherwise
 * the default tool-calling model. `ramGB` unknown → assume 8 GB.
 */
export function recommendOllamaModel(opts: { hebrew: boolean; ramGB?: number | null; tools?: boolean }): OllamaCatalogEntry {
  const ram = opts.ramGB ?? 8;
  const fits = OLLAMA_CATALOG.filter((e) => e.ramGB <= Math.max(ram, 4) && (!opts.tools || e.tools));
  const pool = fits.length ? fits : OLLAMA_CATALOG.filter((e) => !opts.tools || e.tools);
  if (!opts.hebrew) return pool.find((e) => e.name === "qwen2.5:7b") ?? pool[0];
  return [...pool].sort(
    (a, b) => (b.measured ?? -1) - (a.measured ?? -1) || RANK[b.hebrew] - RANK[a.hebrew] || b.params - a.params,
  )[0];
}

/**
 * Are the user's notes in Hebrew? The UI locale, or the open note being
 * mostly Hebrew letters.
 */
export function prefersHebrew(locale: string | null | undefined, sample: string | null | undefined): boolean {
  if (locale === "he") return true;
  const letters = (sample ?? "").slice(0, 4000).match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return false;
  return letters.filter((c) => /\p{Script=Hebrew}/u.test(c)).length / letters.length >= 0.3;
}
