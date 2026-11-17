/**
 * Harness for the injection golden set (plan 2.7, 7.1): the classifier
 * layer of the untrusted-text guard, as the app runs it — the text cut into
 * passages and scored by src/agents/injectionClassifier.ts's classifyText
 * with ProtectAI v2 (protectAiClassifier over the engine module
 * scripts/eval-public/engines/protectai.mjs) when LUMEN_INJECTION_ENGINE
 * names it. The rules are measured by injectionGuard.test.ts (130 cases).
 *
 *   score({ items }) → {
 *     "recall.classifier"  share of carriers with an injection where a passage is flagged
 *     "fpr.classifier"     share of clean texts (the carrier with the injection taken out, or a benign item) flagged
 *     "n.positive", "n.negative"
 *     "classifier.model"   1 when a model ran, 0 otherwise (then nothing else is scored)
 *   }
 *
 *   LUMEN_INJECTION_ENGINE=scripts/eval-public/engines/protectai.mjs LUMEN_INJECTION_MODEL=<folder> \
 *     node scripts/golden/run-evals.mjs --dir <test split>
 */

/** The positive and negative texts of an item: a carrier and its clean version, or a labelled text. */
export function textsOf(item) {
  if (typeof item.carrier === "string") {
    const clean = item.injected ? item.carrier.replace(item.injected, "").replace(/\n{3,}/g, "\n\n").trim() : null;
    return { positive: item.carrier, negative: clean || null };
  }
  const text = item.text ?? item.prompt ?? "";
  if (!text) return { positive: null, negative: null };
  return item.label === "injection" || item.label === 1 ? { positive: text, negative: null } : { positive: null, negative: text };
}

/** Score with `classifyText(text, { classifier })` (the app's) and a classifier. */
export async function scoreWith(classifyText, classifier, items) {
  let pos = 0;
  let tp = 0;
  let neg = 0;
  let fp = 0;
  const flagged = async (t) => {
    const r = await classifyText(t, { classifier, timeoutMs: 600_000 });
    if (!r) throw new Error("the classifier failed or timed out");
    return r.hits.length > 0;
  };
  for (const it of items) {
    const { positive, negative } = textsOf(it);
    if (positive) {
      pos++;
      if (await flagged(positive)) tp++;
    }
    if (negative) {
      neg++;
      if (await flagged(negative)) fp++;
    }
  }
  const r = (x) => Math.round(x * 10000) / 10000;
  return { "recall.classifier": pos ? r(tp / pos) : 0, "fpr.classifier": neg ? r(fp / neg) : 0, "n.positive": pos, "n.negative": neg, "classifier.model": 1 };
}

/** The app's classifier module (TypeScript, no imports) through Vite, in memory, as ner-pii.mjs loads the redactor. */
async function loadSeam() {
  const { build } = await import("vite");
  const { fileURLToPath } = await import("node:url");
  const entry = fileURLToPath(new URL("../../../src/agents/injectionClassifier.ts", import.meta.url));
  const out = await build({ configFile: false, logLevel: "silent", build: { write: false, minify: false, lib: { entry, formats: ["es"], fileName: "ic" } } });
  const chunk = (Array.isArray(out) ? out[0] : out).output.find((o) => o.type === "chunk");
  return import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
}

export async function score({ items }, env = process.env) {
  if (!env.LUMEN_INJECTION_ENGINE) return { "classifier.model": 0 };
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const [seam, mod] = await Promise.all([loadSeam(), import(pathToFileURL(resolve(env.LUMEN_INJECTION_ENGINE)).href)]);
  const engine = await mod.default();
  const classifier = seam.protectAiClassifier((texts) => engine.logits(texts), engine.labels);
  return scoreWith(seam.classifyText, classifier, items);
}
