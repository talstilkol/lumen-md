/**
 * The pins of the Buildkite real-model steps (plan 7.2, W10.E33):
 * models/ci-models.json. A model runs only at its Ollama manifest digest
 * and an image only at its content digest — never `:latest` — and the
 * model cache is keyed by the digest. Plain JavaScript, shared by
 * scripts/real-model-pins.mjs, scripts/buildkite/lib.mjs and the tests.
 */
export const PINS_PATH = "models/ci-models.json";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Problems with the pins: [] when every model and image is pinned to a real digest. */
export function pinProblems(pins, { models = Object.keys(pins.models ?? {}), images = Object.keys(pins.images ?? {}) } = {}) {
  const out = [];
  for (const m of models) {
    const d = pins.models?.[m]?.digest;
    if (!d) out.push(`model ${m}: no pin in ${PINS_PATH}`);
    else if (!DIGEST.test(d)) out.push(`model ${m}: ${d} is not a sha256 digest (pin it on the Mac: ollama pull ${m} && ollama show ${m} --modelfile)`);
  }
  for (const i of images) {
    const d = pins.images?.[i];
    if (!d) out.push(`image ${i}: no pin in ${PINS_PATH}`);
    else if (!DIGEST.test(d)) out.push(`image ${i}: ${d} is not a sha256 digest (pin it on the Mac: docker buildx imagetools inspect ${i})`);
  }
  return out;
}

/** `name@sha256:…`: an image by digest, never by tag. */
export function imageRef(pins, name) {
  const d = pins.images?.[name];
  if (!d) throw new Error(`image ${name}: no pin in ${PINS_PATH}`);
  return `${name}@${d}`;
}

export function modelDigest(pins, model) {
  const d = pins.models?.[model]?.digest;
  if (!d) throw new Error(`model ${model}: no pin in ${PINS_PATH}`);
  return d;
}

/** The model cache directory for a pinned model: a new digest is a new cache. */
export function cacheDir(pins, model, root) {
  return `${root.replace(/\/+$/, "")}/ollama/${modelDigest(pins, model).replace(/^sha256:/, "").slice(0, 16)}`;
}
