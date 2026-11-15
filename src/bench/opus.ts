/**
 * Opus-MT through the app's MT layer (createOpusLayer, plan 6.4, 7.8,
 * W10.E35): the converted model from Lumen's model host, downloaded with
 * the layer's own consent step (running the bench is the owner's consent),
 * then the layer's translate(). Until the converted-model host exists
 * (15.9) the layer is unavailable and the run is an error, never a number.
 */
import { createOpusLayer, OPUS_MODELS } from "../ai/mt/localModels";
import type { Pair } from "../ai/mt/layers";
import { transformersDevice } from "../ai/transformersEngine";
import type { BenchEngine } from "./types";

export function opusEngine(id: string, pair: Pair): BenchEngine {
  const layer = createOpusLayer({ confirm: async () => true, t: (k) => k });
  const model = OPUS_MODELS[`${pair.source}-${pair.target}`];
  return {
    id,
    label: `Opus-MT ${pair.source} → ${pair.target}`,
    set: "mt-he-en",
    task: pair.source === "he" ? "mt-he-en" : "mt-en-he",
    models: [model],
    async load() {
      const a = await layer.availability(pair);
      if (a.state === "unavailable") throw new Error(`Opus-MT ${pair.source}-${pair.target}: ${a.reason}`);
      if (!(await layer.prepare(pair, {}))) throw new Error(`Opus-MT ${pair.source}-${pair.target}: the download did not finish`);
      await layer.translate([pair.source === "he" ? "שלום" : "Hello"], pair, {});
      return { device: await transformersDevice(), model };
    },
    run: async (item) => (await layer.translate([(item.input as { text: string }).text], pair, {}))[0] ?? "",
  };
}
