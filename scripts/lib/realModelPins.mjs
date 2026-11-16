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

/** The content digest `docker buildx imagetools inspect <image>` prints ("Digest:   sha256:…"), or null. */
export function digestFromImagetools(text) {
  const m = /^Digest:\s+(sha256:[0-9a-f]{64})\s*$/m.exec(String(text ?? ""));
  return m ? m[1] : null;
}

/** A model's digest in Ollama's /api/tags answer (the manifest digest, hex with or without "sha256:"), or null. */
export function digestFromTags(tags, model) {
  const e = ((tags && tags.models) || []).find((m) => m.name === model || m.model === model || m.name === `${model}:latest`);
  const d = String(e?.digest ?? "").trim().toLowerCase().replace(/^sha256:/, "");
  return /^[0-9a-f]{64}$/.test(d) ? `sha256:${d}` : null;
}

/**
 * Fill every pin that still reads a placeholder (W10.E33, the Mac's one
 * command): a model from the local Ollama's /api/tags after it is pulled, an
 * image from `docker buildx imagetools inspect`. A pin that is already a
 * digest is kept unless `refresh`. Returns the new pins and one line per
 * pin; nothing is guessed: a digest that cannot be read leaves the
 * placeholder and is reported as a problem.
 * `pull(model)`, `tags()` and `inspect(image)` are seams for the tests.
 */
export async function pinAll(pins, { pull, tags, inspect, refresh = false }) {
  const next = JSON.parse(JSON.stringify(pins));
  const lines = [];
  const problems = [];
  const models = Object.keys(next.models ?? {}).filter((m) => refresh || !DIGEST.test(next.models[m].digest ?? ""));
  for (const m of models) await pull(m);
  const t = models.length ? await tags() : null;
  for (const m of models) {
    const d = digestFromTags(t, m);
    if (d) {
      next.models[m].digest = d;
      lines.push(`model ${m}: ${d}`);
    } else problems.push(`model ${m}: no digest in Ollama's /api/tags after the pull`);
  }
  for (const i of Object.keys(next.images ?? {}).filter((i) => refresh || !DIGEST.test(next.images[i] ?? ""))) {
    const d = digestFromImagetools(await inspect(i));
    if (d) {
      next.images[i] = d;
      lines.push(`image ${i}: ${d}`);
    } else problems.push(`image ${i}: no "Digest:" line from docker buildx imagetools inspect`);
  }
  return { pins: next, lines, problems };
}
