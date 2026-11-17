/**
 * SmolVLM 256M Instruct (transformers.js) through the app's caption worker (plan
 * 6.6, 7.8, W10.E35): one English caption per image, cleaned as the app
 * cleans it. Scored with chrF against the set's English references (the
 * owner's 1–5 rating is the set's headline metric and is not automated).
 */
import { captionLocal, transformersDevice } from "../../ai/transformersEngine";
import { dataUrlBlob, type BenchEngine } from "../types";

// ai/caption.ts is loaded on use (its English is a lazy chunk, i18nLazyEnglish): the id is named here
// and load() checks it against the app's own CAPTION_MODELS, as florence2.ts does.
const MODEL_ID = "HuggingFaceTB/SmolVLM-256M-Instruct";
const MODEL = { id: MODEL_ID, family: "smolvlm" as const };
const caption = () => import("../../ai/caption");

/** A 32×32 grey PNG, enough to load the model. */
async function probeImage(): Promise<Blob> {
  const c = new OffscreenCanvas(32, 32);
  const g = c.getContext("2d")!;
  g.fillStyle = "#888";
  g.fillRect(0, 0, 32, 32);
  return c.convertToBlob({ type: "image/png" });
}

export const engine: BenchEngine = {
  id: "smolvlm",
  label: "SmolVLM 256M Instruct, English caption",
  set: "caption",
  models: [MODEL.id],
  async load() {
    const { CAPTION_MODELS } = await caption();
    if (!CAPTION_MODELS.some((m) => m.id === MODEL.id && m.family === MODEL.family)) throw new Error(`${MODEL.id} is not one of the app's caption models`);
    await captionLocal(MODEL.id, MODEL.family, await probeImage());
    return { device: await transformersDevice(), model: MODEL.id };
  },
  async run(item) {
    const image = await dataUrlBlob((item.input as { image: string }).image);
    const { cleanCaption } = await caption();
    return cleanCaption(await captionLocal(MODEL.id, MODEL.family, image));
  },
};
