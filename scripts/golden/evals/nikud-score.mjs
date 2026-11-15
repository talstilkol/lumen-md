/**
 * The nikud set's scoring (plan 6.3, 7.8), shared by the golden harness
 * (nikud.mjs, Node + onnxruntime-node) and the browser bench
 * (scripts/bench/tasks.mjs). Pure: the caller hands in src/text/nikud.ts's
 * canonicalMarks / sameSkeleton, so the comparison is the app's own.
 *
 *   <part>_word_acc      Hebrew words whose points are all right
 *   <part>_word_acc_voc  same, vowels compared as pronounced
 *   <part>_der           letters with a wrong mark set / letters that take one
 *   skeleton_ok          outputs whose consonants equal the input's (must be 1)
 */

const LETTER = /[א-ת]/;
// What a reference may carry that the model never writes: cantillation, meteg, rafe.
const NOT_MODELLED = /[֑-ֽֿׅ֯ׄ]/g;

export function normalizeRef(s) {
  return s.normalize("NFD").replace(NOT_MODELLED, "").replace(/ׇ/g, "ָ");
}

/** Nakdimon's vocalize(): vowels as pronounced. */
function voc(marks, letter) {
  return [...marks]
    .map((m) => {
      if (m === "ּ") return "בכפ".includes(letter) || letter === "ו" ? m : "";
      if ("ֲַָ".includes(m)) return "ַ";
      if ("ֳֹ".includes(m)) return "ֹ";
      if (m === "ֻ") return "ֻ";
      if ("ֱֵֶ".includes(m)) return "ֶ";
      if (m === "ְ") return "";
      return m;
    })
    .join("");
}

/** [letter, sorted marks] for every Hebrew letter of a word. */
function letters(word, canon) {
  const out = [];
  for (const m of canon(word).matchAll(/([א-ת])([ְ-ׇ]*)/g)) out.push([m[1], [...m[2]].sort().join("")]);
  return out;
}


/**
 * Score `hyps[i]` (the pointed output for `items[i]`, given `inputs[i]`)
 * against each item's pointed `text`. → the metrics above.
 */
export function scoreNikud(items, inputs, hyps, { canonicalMarks, sameSkeleton }) {
  const canon = (s) => canonicalMarks(normalizeRef(s));
  const tally = {};
  let skeletonOk = 0;
  items.forEach((it, idx) => {
    const part = it.part ?? String(it.id ?? "").split("-")[0];
    const t = (tally[part] ??= { words: 0, exact: 0, voc: 0, letters: 0, wrong: 0 });
    const ref = String(it.text ?? "");
    const hyp = typeof hyps[idx] === "string" ? hyps[idx] : "";
    if (sameSkeleton(hyp, inputs[idx])) skeletonOk++;
    const rw = ref.split(/\s+/).filter((w) => LETTER.test(w));
    const hw = hyp.split(/\s+/).filter((w) => LETTER.test(w));
    if (rw.length !== hw.length) {
      t.words += rw.length; // misaligned: every word counts as wrong
      return;
    }
    rw.forEach((r, k) => {
      const a = letters(r, canon);
      const b = letters(hw[k], canon);
      t.words++;
      let exact = a.length === b.length;
      let vocOk = exact;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        t.letters++;
        if (a[i][1] !== b[i][1]) {
          t.wrong++;
          exact = false;
        }
        if (voc(a[i][1], a[i][0]) !== voc(b[i][1], b[i][0])) vocOk = false;
      }
      if (exact) t.exact++;
      if (vocOk) t.voc++;
    });
  });
  const out = { skeleton_ok: items.length ? skeletonOk / items.length : NaN };
  for (const [part, t] of Object.entries(tally)) {
    out[`${part}_word_acc`] = t.words ? t.exact / t.words : NaN;
    out[`${part}_word_acc_voc`] = t.words ? t.voc / t.words : NaN;
    out[`${part}_der`] = t.letters ? t.wrong / t.letters : NaN;
  }
  return out;
}
