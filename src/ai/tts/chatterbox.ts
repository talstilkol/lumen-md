/**
 * Chatterbox Multilingual (Resemble AI, MIT weights) as a Hebrew voice
 * candidate (plan W11.H8). Hidden: ../publicGates.ts shows it only after
 * the ASR round-trip screen (W11.H9) passes and its registry entry is
 * allowed — which waits on the training-data answer from Resemble (W11.O2).
 *
 * The pipeline is fixed here: niqqud first (W2.5: DictaBERT-char-menaked,
 * else Nakdimon — Resemble's reference script dots Hebrew with dicta-onnx
 * before synthesis), then the ONNX model. The runtime is a seam: the
 * desktop runs the ONNX export (BricksDisplay/chatterbox-multilingual-ONNX)
 * first; the browser only if the q4 export fits (owed, W11.M — the graph's
 * input and output names are read from the files when they are pinned).
 * Its output carries Resemble's PerTh watermark; the registry entry says so.
 *
 * Read-aloud (ai/tts.ts) asks `chatterboxForReadAloud()` for Hebrew text
 * when no Piper voice is there: null unless the gate passed and a runtime
 * exists (none yet, see NO_RUNTIME).
 */

export interface ChatterboxAudio {
  samples: Float32Array;
  sampleRate: number;
}

export interface ChatterboxRuntime {
  /** Synthesise dotted Hebrew. */
  synthesize(dotted: string, opts: { language: "he"; signal?: AbortSignal }): Promise<ChatterboxAudio>;
}

export interface ChatterboxDeps {
  /** Add niqqud (nikudService). Returns the text unchanged when no niqqud model is available. */
  nikud: (text: string, signal?: AbortSignal) => Promise<string>;
  runtime: ChatterboxRuntime;
}

const HEBREW = /[א-ת]/;
const POINTED = /[ְ-ׇּׁׂ]/;

/** Text → dotted text → audio. Already-dotted text is not dotted again. */
export async function speakChatterbox(text: string, deps: ChatterboxDeps, signal?: AbortSignal): Promise<ChatterboxAudio> {
  const t = text.normalize("NFC").trim();
  if (!t) return { samples: new Float32Array(0), sampleRate: 24_000 };
  const dotted = HEBREW.test(t) && !POINTED.test(t) ? await deps.nikud(t, signal) : t;
  return deps.runtime.synthesize(dotted, { language: "he", signal });
}

// ------------------------------------------------------------ in read-aloud (W11.H8)

/**
 * The ONNX runtime (desktop first, browser only if the q4 export fits) is
 * owed: W11.M pins the export and its graph's input and output names. Until
 * then there is none, and read-aloud never reaches the model.
 */
const NO_RUNTIME = async (): Promise<ChatterboxRuntime | null> => null;

/**
 * The Chatterbox voice for read-aloud, or null. The public gate decides
 * first (publicGates.ts: a passing ASR round trip in eval/public/_verdicts.json
 * and an allowed, verified registry entry); then a runtime must be there.
 * Today the verdicts are empty, so this is null and the menu offers no
 * neural voice.
 */
export async function chatterboxForReadAloud(gate?: () => Promise<boolean>, runtime: () => Promise<ChatterboxRuntime | null> = NO_RUNTIME): Promise<ChatterboxRuntime | null> {
  const open =
    gate ??
    (async () => {
      const { exposedNeuralVoices, loadGateInputs, NEURAL_VOICE_CANDIDATES } = await import("../publicGates");
      const { verdicts, registry } = await loadGateInputs();
      return exposedNeuralVoices(NEURAL_VOICE_CANDIDATES, verdicts, registry).some((v) => v.engine === "chatterbox");
    });
  if (!(await open())) return null;
  return runtime();
}

/** Read sentences one after another through Web Audio; resolves when done or aborted. */
export async function playChatterbox(sentences: ReadonlyArray<{ text: string }>, deps: ChatterboxDeps & { audio?: AudioContext; onSentence?: (i: number) => void }, signal?: AbortSignal): Promise<void> {
  const ctx = deps.audio ?? new AudioContext();
  for (let i = 0; i < sentences.length; i++) {
    if (signal?.aborted) return;
    const { samples, sampleRate } = await speakChatterbox(sentences[i].text, deps, signal);
    if (signal?.aborted || !samples.length) continue;
    const buf = ctx.createBuffer(1, samples.length, sampleRate);
    buf.copyToChannel(Float32Array.from(samples), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    deps.onSentence?.(i);
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      signal?.addEventListener("abort", () => {
        try {
          src.stop();
        } catch {
          // why: stop() throws when the source already ended
        }
        resolve();
      }, { once: true });
      src.start();
    });
  }
}
