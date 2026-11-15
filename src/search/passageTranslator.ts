/**
 * Local translation of a search hit (plan W5.28): the original paragraph is
 * shown, and next to it a translation made on this device. Never a cloud
 * call. In order:
 *   1. a local translation model of plan 6.4 (Opus-MT, then M2M100, in
 *      transformers.js; src/ai/mt) that is already on this device for the
 *      pair: a search never starts a download or asks to (W10.C seams: the
 *      `registerLocalTranslator` hook no engine called is gone; the layers
 *      are asked directly), or
 *   2. Chrome's built-in Translator API, which runs on the device
 *      (the global `Translator`, Chrome 138+), when it reports the language
 *      pair as available, or
 *   3. nothing: the dialog shows the original only and says why.
 */
import type { MtLayer } from "../ai/mt/layers";

/** The 6.4 model layers, built so they can never ask or download (a search must not). */
async function localLayers(): Promise<MtLayer[]> {
  const { createOpusLayer, createM2m100Layer } = await import("../ai/mt/localModels");
  const never = { confirm: async () => false, t: (k: string) => k };
  return [createOpusLayer(never), createM2m100Layer(never)];
}

/** A layer that has the pair on this device now ("ready"), or null. */
async function readyLayer(layers: MtLayer[], from: string, to: string): Promise<MtLayer | null> {
  const pair = { source: from, target: to };
  for (const l of layers) {
    if (!l.supports(pair)) continue;
    try {
      if ((await l.availability(pair)).state === "ready") return l;
    } catch {
      // why: a layer that cannot tell (no model host, no OPFS) is skipped; the next one is asked
      /* next layer */
    }
  }
  return null;
}

interface ChromeTranslator {
  translate(text: string): Promise<string>;
  destroy?(): void;
}
interface ChromeTranslatorFactory {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeTranslator>;
}

const chromeCache = new Map<string, Promise<ChromeTranslator | null>>();

async function chromeTranslator(from: string, to: string, g: { Translator?: ChromeTranslatorFactory }): Promise<ChromeTranslator | null> {
  const T = g.Translator;
  if (!T?.availability || !T.create) return null;
  const key = `${from}>${to}`;
  if (!chromeCache.has(key)) {
    chromeCache.set(
      key,
      (async () => {
        // Only a pair that is already on the device: "downloadable" would start a download from a search.
        if ((await T.availability({ sourceLanguage: from, targetLanguage: to })) !== "available") return null;
        return T.create({ sourceLanguage: from, targetLanguage: to });
      })().catch(() => null),
    );
  }
  return chromeCache.get(key)!;
}

export interface TranslationResult {
  text: string | null;
  /** Which engine translated, or why nothing did. */
  engine: string | null;
}

export async function translatePassage(
  text: string,
  from: string,
  to: string,
  opts: { signal?: AbortSignal; globals?: { Translator?: ChromeTranslatorFactory }; layers?: MtLayer[] } = {},
): Promise<TranslationResult> {
  const clipped = text.slice(0, 1500);
  const local = await readyLayer(opts.layers ?? (await localLayers().catch(() => [])), from, to);
  if (local) {
    try {
      const [out] = await local.translate([clipped], { source: from, target: to }, { signal: opts.signal });
      if (typeof out === "string") return { text: out, engine: local.id };
    } catch {
      // why: the local model failed: the browser's translator is tried next
      /* fall through to the browser's translator */
    }
  }
  const t = await chromeTranslator(from, to, opts.globals ?? (globalThis as { Translator?: ChromeTranslatorFactory }));
  if (t) {
    try {
      return { text: await t.translate(clipped), engine: "browser" };
    } catch {
      // why: the browser's translator failed: the caller says no translation is available
      /* not translated */
    }
  }
  return { text: null, engine: null };
}

/** Tests. */
export function __resetTranslators(): void {
  chromeCache.clear();
}
