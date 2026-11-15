/**
 * SigLIP multilingual through the app's image search (plan 6.7, 7.8,
 * W10.E35): the split's images are embedded once per part, then each
 * query, in English and in Hebrew (embedded directly: the model is
 * multilingual), ranks them with the app's rankImages(). The model comes
 * from Lumen's converted-model host, so until that host exists (15.9) the
 * engine cannot load and the run is an error, never a number.
 */
import { CONVERTED_MODELS_BASE, requestConvertedModel } from "../../ai/convertedModels";
import { SIGLIP_ID, queryVector, rankImages, type ImageIndex } from "../../ai/imageSearch";
import { embedImagesLocal, embedTextsForImagesLocal, translationDtypeFor, transformersDevice } from "../../ai/transformersEngine";
import { dataUrlBlob, type BenchEngine } from "../types";

let host: { base: string; dtype: "q8" | "q4f16" } | null = null;
const indexes = new Map<string, ImageIndex>();

const embedText = (texts: string[]) => embedTextsForImagesLocal(SIGLIP_ID, texts, { host: host!.base, dtype: host!.dtype });

export const engine: BenchEngine = {
  id: "siglip",
  label: "SigLIP base multilingual, image search",
  set: "image-search",
  models: [SIGLIP_ID],
  async load() {
    if (!CONVERTED_MODELS_BASE) throw new Error("the converted-model host is not set (15.9): SigLIP cannot be downloaded");
    const dtype = translationDtypeFor(await transformersDevice());
    // Running the benchmark is the owner's consent to the download.
    const answer = await requestConvertedModel(SIGLIP_ID, dtype, { confirm: async () => true, isCached: async () => false, t: (k) => k, base: CONVERTED_MODELS_BASE });
    if (answer !== "ready") throw new Error(`SigLIP: ${answer}`);
    host = { base: CONVERTED_MODELS_BASE, dtype };
    await embedText(["טעינה"]);
    return { device: await transformersDevice(), model: SIGLIP_ID };
  },
  async prepare(part, shared) {
    const images = (shared as { images: Array<{ id: string; image: string }> }).images;
    const vectors = await embedImagesLocal(SIGLIP_ID, await Promise.all(images.map((x) => dataUrlBlob(x.image))), { host: host!.base, dtype: host!.dtype });
    indexes.set(part, { model: SIGLIP_ID, images: images.map((x, i) => ({ path: x.id, size: 0, modified: 0, vector: vectors[i] })) });
  },
  async run(item) {
    const index = indexes.get(item.part)!;
    const { query, query_he } = item.input as { query: string; query_he: string };
    const rank = async (q: string) => rankImages(index, (await queryVector(q, { embedText, hebrewDirect: true })).vector, 10).map((h) => h.path);
    return { en: await rank(query), he: query_he ? await rank(query_he) : [] };
  },
  dispose: async () => indexes.clear(),
};
