/**
 * Models Lumen converts to ONNX itself (plan 6.0):
 * .github/workflows/model-convert.yml exports and quantises them, and
 * models/registry.json lists every published file with its sha256, size,
 * licence and attribution.
 *
 * Downloads are consent-only (the size is shown first), verified against
 * those checksums and cached in OPFS (./modelCache.ts); nothing downloads
 * while CONVERTED_MODELS_BASE is null.
 */

export type ConvertedDtype = "q8" | "q4f16";

export interface ConvertedModel {
  /** Folder name on the host, and the registry id. */
  id: string;
  task: "translation" | "token-classification" | "zero-shot-image-classification";
  /** What the model is for, as an i18n key. */
  purposeKey: string;
}

export const CONVERTED_MODELS: ConvertedModel[] = [
  { id: "opus-mt-en-he", task: "translation", purposeKey: "models.purpose.translateEnHe" },
  { id: "opus-mt-tc-big-he-en", task: "translation", purposeKey: "models.purpose.translateHeEn" },
  { id: "dictabert-ner", task: "token-classification", purposeKey: "models.purpose.nerHe" },
  { id: "siglip-base-patch16-256-multilingual", task: "zero-shot-image-classification", purposeKey: "models.purpose.imageSearch" },
];

/**
 * Where the converted files are served from: `${base}${id}/${path}`.
 * TODO(15.9): Tal picks the host (GitHub Releases if the repo is public,
 * otherwise Hugging Face). Until then the models cannot be downloaded and
 * the features that need them say so.
 */
export const CONVERTED_MODELS_BASE: string | null = null;

export interface RegistryFile {
  path: string;
  sha256: string;
  bytes: number;
  dtype?: string;
  license: string;
  attribution: string;
}

export interface RegistryModel {
  id: string;
  license: string;
  attribution: string;
  files?: RegistryFile[];
}

/** The files a dtype needs: its ONNX files and every config / tokenizer file. */
export function filesFor(entry: RegistryModel, dtype: ConvertedDtype): RegistryFile[] {
  return (entry.files ?? []).filter((f) => f.dtype === dtype || f.dtype === "config");
}

/** Download size of a model in one dtype, in bytes. */
export function downloadBytes(entry: RegistryModel, dtype: ConvertedDtype): number {
  return filesFor(entry, dtype).reduce((sum, f) => sum + f.bytes, 0);
}

/** "612 MB" / "48.3 MB": what the consent dialog shows before anything is fetched. */
export function formatSize(bytes: number, locale?: string): string {
  const mb = bytes / 1e6;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: mb >= 100 ? 0 : 1 }).format(mb);
  return `${n} MB`;
}

/** The URL of one model file on the host, or null while there is no host (15.9). */
export function fileUrl(id: string, path: string, base: string | null = CONVERTED_MODELS_BASE): string | null {
  if (!base) return null;
  return `${base.endsWith("/") ? base : base + "/"}${id}/${path}`;
}

/** The registry entries of the converted models (lazy: the registry is not in the startup bundle). */
export async function loadConvertedRegistry(): Promise<Map<string, RegistryModel>> {
  const mod = (await import("../../models/registry.json")) as unknown as { default?: { models: RegistryModel[] }; models?: RegistryModel[] };
  const models = (mod.default ?? mod).models ?? [];
  const ids = new Set(CONVERTED_MODELS.map((m) => m.id));
  return new Map(models.filter((m) => ids.has(m.id)).map((m) => [m.id, m]));
}
