/**
 * Nikud through the app's niqqud service (plan 6.3, 7.8, W10.E34): the
 * model is downloaded from Lumen's converted-model host with the service's
 * own consent step (running the bench is the owner's consent) and runs in
 * the app's nikud worker. The service picks DictaBERT-char-menaked unless
 * the user chose "fast" (Nakdimon); the engine sets that choice and checks
 * which model answered. Until the converted-model host exists (15.9) the
 * service has nothing to load and the run is an error, never a number.
 */
import { MENAKED_ID, NAKDIMON_ID, NIKUD_QUALITY_KEY, __resetNikud, pointHebrewDetailed, type NikudDeps, type NikudEngineId } from "../ai/nikudService";
import type { BenchEngine } from "./types";

const deps: NikudDeps = { consent: { confirm: async () => true, t: (k) => k } };

export function nikudEngine(id: string, which: NikudEngineId): BenchEngine {
  const point = async (text: string) => {
    const r = await pointHebrewDetailed(text, deps);
    if (r.engine !== which) throw new Error(`asked for ${which}, the nikud service ran ${r.engine}`);
    return r.text;
  };
  return {
    id,
    label: which === "menaked" ? "DictaBERT-char-menaked, nikud" : "Nakdimon, nikud",
    set: "nikud",
    models: [which === "menaked" ? MENAKED_ID : NAKDIMON_ID],
    async load() {
      __resetNikud();
      if (which === "nakdimon") localStorage.setItem(NIKUD_QUALITY_KEY, "fast");
      else localStorage.removeItem(NIKUD_QUALITY_KEY);
      await point("שלום עולם");
      // The worker runs ONNX Runtime Web on wasm.
      return { device: "wasm", model: which === "menaked" ? MENAKED_ID : NAKDIMON_ID };
    },
    run: async (item) => point((item.input as { text: string }).text),
    dispose: async () => __resetNikud(),
  };
}
