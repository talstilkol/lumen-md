/**
 * Text normalisers for public benchmarks (plan W11.H5, W11.H6).
 *
 * FLEURS-he WER moves by about 12 points with the normaliser (research
 * R2 §1.2: 20.5 % for Whisper-turbo under kol-stream's, 8.9–23.6 % under
 * ours), so a number is only comparable with another measured under the
 * same one. The manifests name the normaliser by id.
 *
 * "ivrit-leaderboard" is a TypeScript port of `HebrewTextNormalizer` in
 * ivrit-ai/asr-training evaluate_model.py (MIT), the normalisation the
 * ivrit.ai Hebrew Transcription Leaderboard applies before WER, read at
 * these commits (2026-11-16):
 *   ivrit-ai/asr-training  e333b4a0fb35bc626e7d4da88250936ff773475e
 *   avi-perl/hebrew        55d4d6786b87c40e5f43b7cb060b03bd5126a9b1 (MIT; `Hebrew(t).no_niqqud()`)
 *   openai/whisper         86098128c0b4f24f0e2aa2994de830614b474227 (MIT; normalizers/basic.py)
 * In order:
 *  1. delete U+061C, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF;
 *  2. delete the 18 niqqud points of `hebrew.chars.NIQQUD_CHARS` with plain
 *     string replaces: no Unicode normalisation first, and the cantillation
 *     marks, meteg (U+05BD) and rafe (U+05BF) are NOT niqqud there (they are
 *     TaamimChar), so they reach step 4 and become spaces. SHURUK ("וּ") is
 *     in the list after DAGESH, so the dagesh is already gone and the vav
 *     stays;
 *  3. delete the double-quote variants " U+05F4 U+201C–U+201F « » U+FF02
 *     and the ASCII apostrophe (so צה״ל and צה"ל are צהל; geresh U+05F3 is
 *     punctuation and becomes a space in step 4);
 *  4. Whisper's BasicTextNormalizer(): lower-case; drop [..], <..> spans and
 *     (..) spans; NFKC; every mark, symbol and punctuation character becomes
 *     a space; lower-case; every run of Python `\s` becomes one space. It
 *     does not strip: a leading or trailing space stays (jiwer strips before
 *     scoring, as metrics.ts does).
 *
 * The port was written from reading that code; running the Python original
 * here was refused, so `npm run eval:public -- parity` (50 leaderboard
 * samples, scripts/eval-public/normalizer_parity.py) is still the check, and
 * until it passes results carry `normalizerParity: "unverified"`.
 */

/** Step 1: controls the ivrit.ai normaliser deletes (not spaces: they glue nothing). */
const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
/** Step 2: hebrew.chars.NIQQUD_CHARS — U+05B0–U+05BC, shin and sin dots, upper and lower dots, qamats qatan. Not the cantillation, meteg or rafe. */
const NIQQUD = /[\u05B0-\u05BC\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
/** Step 3: double-quote variants and the ASCII apostrophe. */
const QUOTES = /["'\u05F4\u201C-\u201F\u00AB\u00BB\uFF02]/g;
/** Python's `\s` on str (str.isspace): JavaScript's `\s` lacks U+001C–U+001F and U+0085, and has U+FEFF, which Python's has not. */
const PY_SPACE = /[\t\n\v\f\r\x1C-\x1F \x85\xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

/** openai/whisper `BasicTextNormalizer()(s)` (remove_diacritics=False, split_letters=False), exactly: no strip. */
export function whisperBasic(s: string): string {
  let t = s.toLowerCase();
  t = t.replace(/[<[][^>\]]*[>\]]/g, "");
  t = t.replace(/\(([^)]+?)\)/g, "");
  t = t.normalize("NFKC").replace(/[\p{M}\p{S}\p{P}]/gu, " ");
  t = t.toLowerCase();
  return t.replace(PY_SPACE, " ");
}

export function ivritLeaderboard(s: string): string {
  return whisperBasic(String(s ?? "").replace(INVISIBLE, "").replace(NIQQUD, "").replace(QUOTES, ""));
}

export const NORMALIZERS: Record<string, (s: string) => string> = {
  none: (s) => s,
  nfc: (s) => s.normalize("NFC"),
  "whisper-basic": whisperBasic,
  "ivrit-leaderboard": ivritLeaderboard,
};

export function normalizer(id: string): (s: string) => string {
  const f = NORMALIZERS[id];
  if (!f) throw new Error(`unknown normaliser "${id}" (known: ${Object.keys(NORMALIZERS).join(", ")})`);
  return f;
}

/** Normalisers whose parity with the original implementation is not yet checked (see the file comment). */
export const UNVERIFIED_PARITY = new Set(["ivrit-leaderboard"]);
