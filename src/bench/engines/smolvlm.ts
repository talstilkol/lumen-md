/**
 * SmolVLM 256M Instruct (transformers.js) through the app's caption worker (plan
 * 6.6, 7.8, W10.E35): one English caption per image, cleaned as the app
 * cleans it. Scored with chrF against the set's English references (the
 * owner's 1–5 rating is the set's headline metric and is not automated).
 */
import { CAPTION_MODELS, cleanCaption } from "../../ai/caption";
import { captionLocal, transformersDevice } from "../../ai/transformersEngine";
import { dataUrlBlob, type BenchEngine } from "../types";

const MODEL = CAPTION_MODELS.find((m) => m.family === "smolvlm")!;

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
    await captionLocal(MODEL.id, MODEL.family, await probeImage());
    return { device: await transformersDevice(), model: MODEL.id };
  },
  async run(item) {
    const image = await dataUrlBlob((item.input as { image: string }).image);
    return cleanCaption(await captionLocal(MODEL.id, MODEL.family, image));
  },
};
