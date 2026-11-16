/**
 * Any outside command as an engine of `npm run eval:public -- run` (wave g6,
 * for the Mac run: W11.M1–M3, W11.M13, W11.H7, H9, H10, H11, H14, H18).
 * The model runs where it already runs — whisper.cpp, sherpa-onnx, a Python
 * script, onnxruntime — and this module only feeds it one item at a time.
 * No network of its own; the command decides what it loads.
 *
 *   LUMEN_ENGINE_ID=whisper.cpp:ivrit-turbo \
 *   LUMEN_ASR_CMD='whisper-cli -m ggml-ivrit-turbo.bin -l he -nt -np -f {in}' \
 *   npm run eval:public -- run asr-ivrit-eval-d1 --engine scripts/eval-public/engines/cmd.mjs --model ivrit-ai/whisper-large-v3-turbo --rev <rev>
 *
 * One variable per method; a method whose variable is unset is left out, so
 * the runner's own check ("a tts-roundtrip engine module returns …") still
 * names what is missing:
 *
 *   LUMEN_ASR_CMD     transcribe(audio)      {in} = the audio file          stdout = the text
 *   LUMEN_NIKUD_CMD   dot(text)              stdin = undotted text          stdout = dotted text
 *   LUMEN_G2P_CMD     phonemize(sentence)    stdin = the sentence           stdout = one IPA word per line (or space-separated)
 *   LUMEN_OCR_CMD     recognize(image)       {in} = the image file          stdout = the text
 *   LUMEN_NER_CMD     tag(tokens)            stdin = one token per line     stdout = one tag per line
 *   LUMEN_LEMMA_CMD   lemmatize(words,text)  stdin = JSON {words, text}     stdout = JSON array of lemmas
 *   LUMEN_TTS_CMD     synthesize(text, id)   stdin = the text, {out} = .wav to write (under --data/.tts/<id>.wav)
 *   LUMEN_JUDGE_CMD   judge.transcribe       like LUMEN_ASR_CMD (the ASR that listens to the voice)
 *
 * {in} and {out} are shell-quoted. A command that exits non-zero throws with
 * its stderr; the scorers count that item as failed (ASR lists it in
 * `failed` and charges its full length), never as a silent success.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const quote = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

/** Run one command template; returns stdout without its final newline. */
export function runTemplate(template, { input, inPath, outPath, env = process.env } = {}) {
  const cmd = template.replaceAll("{in}", inPath === undefined ? "" : quote(inPath)).replaceAll("{out}", outPath === undefined ? "" : quote(outPath));
  const r = spawnSync("sh", ["-c", cmd], { input: input ?? "", encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  // EPIPE: the command did not read its stdin (it needs only {in}); its exit status still decides.
  if (r.error && !(r.error.code === "EPIPE" && r.status !== null)) throw r.error;
  if (r.status !== 0) throw new Error(`engine command failed (exit ${r.status}): ${cmd}\n${(r.stderr || "").trim()}`);
  return r.stdout.replace(/\r?\n$/, "");
}

const lines = (s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The engine for the variables in `env` (exported for the test). */
export function makeEngine(env = process.env, dataDir = ".") {
  const id = env.LUMEN_ENGINE_ID;
  if (!id) throw new Error("set LUMEN_ENGINE_ID (what ran: tool and model, e.g. whisper.cpp:ivrit-turbo-q5)");
  const e = { id };
  const t = (name) => env[name];
  if (t("LUMEN_ASR_CMD")) e.transcribe = async (audio) => runTemplate(t("LUMEN_ASR_CMD"), { inPath: audio, env }).trim();
  if (t("LUMEN_NIKUD_CMD")) e.dot = async (text) => runTemplate(t("LUMEN_NIKUD_CMD"), { input: text, env });
  if (t("LUMEN_G2P_CMD")) {
    e.phonemize = async (sentence) => {
      const out = runTemplate(t("LUMEN_G2P_CMD"), { input: sentence, env });
      const ls = lines(out);
      return ls.length > 1 ? ls : out.trim().split(/\s+/).filter(Boolean);
    };
  }
  if (t("LUMEN_OCR_CMD")) e.recognize = async (image) => runTemplate(t("LUMEN_OCR_CMD"), { inPath: image, env }).trim();
  if (t("LUMEN_NER_CMD")) {
    e.tag = async (tokens) => {
      const tags = lines(runTemplate(t("LUMEN_NER_CMD"), { input: tokens.join("\n") + "\n", env }));
      if (tags.length !== tokens.length) throw new Error(`NER command returned ${tags.length} tags for ${tokens.length} tokens`);
      return tags;
    };
  }
  if (t("LUMEN_LEMMA_CMD")) e.lemmatize = async (words, text) => JSON.parse(runTemplate(t("LUMEN_LEMMA_CMD"), { input: JSON.stringify({ words, text }), env }));
  if (t("LUMEN_TTS_CMD")) {
    const dir = join(dataDir, ".tts", id.replace(/[^\w.-]+/g, "_"));
    e.synthesize = async (text, itemId) => {
      mkdirSync(dir, { recursive: true });
      const out = join(dir, `${String(itemId).replace(/[^\w.-]+/g, "_")}.wav`);
      runTemplate(t("LUMEN_TTS_CMD"), { input: text, outPath: out, env });
      return out;
    };
  }
  if (t("LUMEN_JUDGE_CMD")) {
    const judgeCmd = t("LUMEN_JUDGE_CMD");
    e.judge = { id: env.LUMEN_JUDGE_ID || "judge", transcribe: async (audio) => runTemplate(judgeCmd, { inPath: audio, env }).trim() };
  }
  if (Object.keys(e).length === 1) throw new Error("no LUMEN_*_CMD is set: the engine would have no method (see scripts/eval-public/engines/cmd.mjs)");
  return e;
}

export default async ({ dataDir } = {}) => makeEngine(process.env, dataDir ?? ".");
