/**
 * Desktop Whisper (whisper.cpp with ivrit.ai's large-v3 turbo, GGML) through
 * the app's own path (src/ai/dictation/whisperDesktop.ts, W10.E35):
 * transcribeDesktop() over the Tauri command. It runs only inside the
 * desktop app with the pinned model installed; the bench page in a plain
 * browser is an error ("web"), never a number.
 */
import { desktopWhisperStatus, transcribeDesktop, WHISPER_GGML } from "../../ai/dictation/whisperDesktop";
import { decodeAudioTo16k } from "../../ai/transformersEngine";
import { dataUrlBlob, type BenchEngine } from "../types";

export const engine: BenchEngine = {
  id: "whisper-desktop",
  label: "whisper.cpp, ivrit.ai large-v3 turbo (desktop)",
  set: "asr-he",
  models: [WHISPER_GGML.sourceRepo, "whisper.cpp"],
  async load() {
    const s = await desktopWhisperStatus();
    if (s.kind !== "ready") throw new Error(`desktop Whisper is not ready here: ${s.kind}`);
    await transcribeDesktop(new Float32Array(16_000), { language: "he" });
    // whisper-cli picks Metal, CUDA or the CPU itself; the page cannot tell which.
    return { device: "cpu", model: WHISPER_GGML.sourceRepo };
  },
  async run(item) {
    const pcm = await decodeAudioTo16k(await dataUrlBlob((item.input as { audio: string }).audio));
    return (await transcribeDesktop(pcm, { language: "he" })).map((s) => s.text.trim()).join(" ").trim();
  },
};
