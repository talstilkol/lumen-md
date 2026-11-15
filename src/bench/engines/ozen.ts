/** Ozen v1 (transformers.js) on the Hebrew speech set, through the app's transcribeAudio() (W10.E35). Hebrew-only: the worker sends no language token for it, whatever `language` says. */
import { decodeAudioTo16k, transcribeAudio, transformersDevice, WHISPER_MODELS } from "../../ai/transformersEngine";
import { dataUrlBlob, type BenchEngine } from "../types";

const MODEL = WHISPER_MODELS.ozenHe;

export const engine: BenchEngine = {
  id: "ozen",
  label: "Ozen v1 (Hebrew, distilled from ivrit.ai turbo)",
  set: "asr-he",
  models: [MODEL],
  async load() {
    // One second of silence: loads (and on a cold cache downloads) the model.
    await transcribeAudio(new Float32Array(16_000), { language: "he", model: MODEL });
    return { device: await transformersDevice(), model: MODEL };
  },
  async run(item) {
    const pcm = await decodeAudioTo16k(await dataUrlBlob((item.input as { audio: string }).audio));
    return (await transcribeAudio(pcm, { language: "he", model: MODEL })).text;
  },
};
