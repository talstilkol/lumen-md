/**
 * Nikud through the app's niqqud service (plan 6.3, 7.8, W10.E34): the
 * model is downloaded from Lumen's converted-model host with the service's
 * own consent step (running the bench is the owner's consent) and runs in
 * the app's nikud worker. The service picks DictaBERT-char-menaked unless
 * the user chose "fast" (Nakdimon); the engine sets that choice and checks
 * which model answered. Until the converted-model host exists (15.9) the
 * service has nothing to load and the run is an error, never a number.
 */
import type { NikudDeps, NikudEngineId } from "../ai/nikudService";
import type { BenchEngine } from "./types";

// ai/nikudService.ts is loaded on use (its English is a lazy chunk, i18nLazyEnglish): the model ids
// are named here and load() checks them against the service's own.
const MENAKED_ID = "dictabert-char-menaked";
const NAKDIMON_ID = "nakdimon";
const service = () => import("../ai/nikudService");
const deps: NikudDeps = { consent: { confirm: async () => true, t: (k) => k } };

export function nikudEngine(id: string, which: NikudEngineId): BenchEngine {
  const point = async (text: string) => {
    const r = await (await service()).pointHebrewDetailed(text, deps);
    if (r.engine !== which) throw new Error(`asked for ${which}, the nikud service ran ${r.engine}`);
    return r.text;
  };
  return {
    id,
    label: which === "menaked" ? "DictaBERT-char-menaked, nikud" : "Nakdimon, nikud",
    set: "nikud",
    models: [which === "menaked" ? MENAKED_ID : NAKDIMON_ID],
    async load() {
      const svc = await service();
      if (svc.MENAKED_ID !== MENAKED_ID || svc.NAKDIMON_ID !== NAKDIMON_ID) throw new Error("the nikud service's model ids changed");
      svc.__resetNikud();
      if (which === "nakdimon") localStorage.setItem(svc.NIKUD_QUALITY_KEY, "fast");
      else localStorage.removeItem(svc.NIKUD_QUALITY_KEY);
      await point("שלום עולם");
      // The worker runs ONNX Runtime Web on wasm.
      return { device: "wasm", model: which === "menaked" ? MENAKED_ID : NAKDIMON_ID };
    },
    run: async (item) => point((item.input as { text: string }).text),
    dispose: async () => (await service()).__resetNikud(),
  };
}
