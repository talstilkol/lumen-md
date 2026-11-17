/**
 * Plan W13.W18 — is a held-out set ready to back a ✅? For the writing
 * agents: every set whose id starts with the prefix ("writing") is in the
 * manifest, sealed by the evaluator (W6.17: items encrypted outside the
 * repo, only the seal here), and its labels come from two annotators who did
 * not write the rules, with Cohen's kappa >= 0.6 between them
 * (`agreement: { annotators, items, kappa }`, recorded with
 * scripts/writing-agreement.mjs). Pure: the manifest in, lines and a verdict out.
 */
export const MIN_KAPPA = 0.6;
export const MIN_ITEMS_PER_ANNOTATOR = 300;

/** @param {{ sets?: Array<Record<string, any>> }} manifest @param {string} prefix */
export function checkWritingSet(manifest, prefix = "writing") {
  const sets = (manifest?.sets ?? []).filter((s) => typeof s?.id === "string" && (s.id === prefix || s.id.startsWith(`${prefix}-`)));
  const lines = [];
  if (!sets.length) {
    lines.push(`✗ no held-out set "${prefix}" in eval/heldout/manifest.json — owner action W13.W18: 2 Hebrew-speaking annotators who did not write the rules, ${MIN_ITEMS_PER_ANNOTATOR} items each, then \`npm run heldout -- build --sets ${prefix}…\``);
    return { ok: false, lines };
  }
  let ok = true;
  for (const s of sets) {
    const problems = [];
    if (!s.sealed) problems.push("not sealed (npm run heldout -- build --record)");
    const a = s.agreement;
    if (!a) problems.push("no annotator agreement recorded (scripts/writing-agreement.mjs)");
    else {
      if (!(Number.isInteger(a.annotators) && a.annotators >= 2)) problems.push(`annotators: ${a.annotators} < 2`);
      if (!(Number.isInteger(a.items) && a.items >= MIN_ITEMS_PER_ANNOTATOR)) problems.push(`items per annotator: ${a.items} < ${MIN_ITEMS_PER_ANNOTATOR}`);
      if (!(typeof a.kappa === "number" && a.kappa >= MIN_KAPPA)) problems.push(`kappa ${a.kappa} < ${MIN_KAPPA}`);
      if (a.ruleAuthors !== false) problems.push("the annotators must not be the rules' authors (agreement.ruleAuthors: false)");
    }
    if (problems.length) ok = false;
    lines.push(problems.length ? `✗ ${s.id}: ${problems.join("; ")}` : `✓ ${s.id}: sealed v${s.sealed.version} (${s.sealed.n} items), ${a.annotators} annotators, kappa ${a.kappa}`);
  }
  return { ok, lines };
}
