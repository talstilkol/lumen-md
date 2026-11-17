/**
 * Wave g6 (Mac pack L5): scripts/eval-public/engines/cmd.mjs, the engine
 * that lets `npm run eval:public -- run` drive a model through an outside
 * command (whisper.cpp, sherpa-onnx, a Python script) — one command per Mac
 * step instead of one engine module per model.
 *
 * The commands here are tiny shell stand-ins (cat, printf, sh); no model.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import factory, { makeEngine, runTemplate } from "../../scripts/eval-public/engines/cmd.mjs";
import { scoreAsr } from "../eval/public/adapters/asr";
import { scoreNer } from "../eval/public/adapters/ner";

type Engine = {
  id: string;
  transcribe?: (a: string) => Promise<string>;
  dot?: (t: string) => Promise<string>;
  phonemize?: (s: string) => Promise<string[]>;
  tag?: (t: readonly string[]) => Promise<string[]>;
  lemmatize?: (w: string[], t: string) => Promise<string[]>;
  synthesize?: (t: string, id: string) => Promise<string>;
  judge?: { id: string; transcribe: (a: string) => Promise<string> };
};
const engine = (env: Record<string, string>, dir = "."): Engine => makeEngine({ PATH: process.env.PATH ?? "", ...env }, dir) as Engine;

describe("eval:public cmd engine", () => {
  it("needs an id and at least one command", () => {
    expect(() => engine({ LUMEN_ASR_CMD: "cat {in}" })).toThrow(/LUMEN_ENGINE_ID/);
    expect(() => engine({ LUMEN_ENGINE_ID: "x" })).toThrow(/no LUMEN_\*_CMD/);
  });

  it("only the methods whose command is set exist, so the runner names a missing one", () => {
    const e = engine({ LUMEN_ENGINE_ID: "x", LUMEN_ASR_CMD: "cat {in}" });
    expect(typeof e.transcribe).toBe("function");
    expect(e.dot).toBeUndefined();
    expect(e.judge).toBeUndefined();
  });

  it("passes the file path shell-quoted, even with spaces and quotes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmd-engine-"));
    const audio = join(dir, "it's a clip.wav");
    writeFileSync(audio, "שלום עולם\n");
    const e = engine({ LUMEN_ENGINE_ID: "stand-in", LUMEN_ASR_CMD: "cat {in}" });
    await expect(e.transcribe!(audio)).resolves.toBe("שלום עולם");
  });

  it("text goes in on stdin (nikud, g2p) and comes back from stdout", async () => {
    const e = engine({ LUMEN_ENGINE_ID: "x", LUMEN_NIKUD_CMD: "cat", LUMEN_G2P_CMD: "printf 'ʃa.lom\\nʔo.lam\\n'" });
    await expect(e.dot!("שָׁלוֹם")).resolves.toBe("שָׁלוֹם");
    await expect(e.phonemize!("שלום עולם")).resolves.toEqual(["ʃa.lom", "ʔo.lam"]);
  });

  it("NER: one tag per token, and a count that differs is an error, not a shifted score", async () => {
    const ok = engine({ LUMEN_ENGINE_ID: "x", LUMEN_NER_CMD: "sed 's/.*/O/'" });
    await expect(ok.tag!(["דוד", "בן", "גוריון"])).resolves.toEqual(["O", "O", "O"]);
    const short = engine({ LUMEN_ENGINE_ID: "x", LUMEN_NER_CMD: "head -n 1 | sed 's/.*/O/'" });
    await expect(short.tag!(["א", "ב"])).rejects.toThrow(/1 tags for 2 tokens/);
  });

  it("a command that fails throws with its exit code and stderr", () => {
    expect(() => runTemplate("echo broken >&2; exit 3")).toThrow(/exit 3[\s\S]*broken/);
  });

  it("TTS writes the wav under the data folder and the judge reads it back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmd-engine-tts-"));
    const e = engine({ LUMEN_ENGINE_ID: "voice/x", LUMEN_TTS_CMD: "cat > {out}", LUMEN_JUDGE_CMD: "cat {in}", LUMEN_JUDGE_ID: "asr-judge" }, dir);
    const wav = await e.synthesize!("בוקר טוב", "fleurs 12");
    expect(wav.startsWith(join(dir, ".tts"))).toBe(true);
    expect(existsSync(wav)).toBe(true);
    expect(readFileSync(wav, "utf8")).toBe("בוקר טוב");
    expect(e.judge!.id).toBe("asr-judge");
    await expect(e.judge!.transcribe(wav)).resolves.toBe("בוקר טוב");
  });

  it("feeds the real scorers: WER from an outside ASR, F1 from an outside tagger", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmd-engine-score-"));
    writeFileSync(join(dir, "a.wav"), "שלום עולם");
    writeFileSync(join(dir, "b.wav"), "בוקר");
    const asr = engine({ LUMEN_ENGINE_ID: "x", LUMEN_ASR_CMD: "cat {in}" });
    const s = await scoreAsr(
      [
        { id: "a", audio: join(dir, "a.wav"), text: "שלום עולם" },
        { id: "b", audio: join(dir, "b.wav"), text: "בוקר טוב" },
      ],
      asr as Required<Pick<Engine, "id" | "transcribe">>,
      (x) => x,
    );
    expect(s.metrics.wer).toBeCloseTo(1 / 4, 4);
    expect(s.failed).toEqual([]);

    const ner = engine({ LUMEN_ENGINE_ID: "x", LUMEN_NER_CMD: "sed -e 's/^דוד$/B-PER/' -e 's/^[^B].*$/O/'" });
    const n = await scoreNer([{ id: "s1", tokens: ["דוד", "הלך"], tags: ["B-PER", "O"] }], ner as Required<Pick<Engine, "id" | "tag">>);
    expect(n.metrics.f1).toBe(1);
  });

  it("the default export is the runner's async factory", async () => {
    const before = { ...process.env };
    process.env.LUMEN_ENGINE_ID = "factory";
    process.env.LUMEN_OCR_CMD = "cat {in}";
    try {
      const e = (await factory({ dataDir: "." })) as Engine & { recognize?: unknown };
      expect(e.id).toBe("factory");
      expect(typeof e.recognize).toBe("function");
    } finally {
      process.env = before;
    }
  });
});
