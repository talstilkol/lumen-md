/**
 * Voice memo capture (F2 / γ.4).
 *
 * Two flows live behind the same UI:
 *   - **Dictation** (`startVoiceRecording`): Whisper on this device in
 *     ~5-second segments (plan 1.3). The browser's `SpeechRecognition` sends
 *     audio to its vendor, so it is used only outside local-only and only
 *     after the user agrees; every use is in the privacy ledger.
 *   - **Memo mode** (when `aiKey` is set OR Privacy Mode is on):
 *     `MediaRecorder` captures the audio, on stop we Whisper-transcribe
 *     + AI-summarize and insert a `> 🎙 Voice memo` block at the cursor.
 *
 * The memo flow follows the AI policy — by default Whisper runs on this
 * device through transformers.js (src/ai/transformersEngine.ts) and the
 * summary through the local model, so no audio bytes leave the browser.
 *
 * `startVoiceMemo()` wraps the memo flow.
 */

import { createRoot } from "react-dom/client";
import { useAppStore } from "../store/useStore";
import { showAiToast } from "./AiToast";
import { t } from "../i18n";
import { transcribe, summarizeMemo, formatVoiceMemo } from "../ai/transcribe";
import { aiOperation, isAbort } from "../ai/aiAbort";
import { log } from "../lib/logger";
import { getAiPolicy } from "../ai/policy";
import { recordSpeechRecognition } from "../ai/privacyLedger";
import { chooseDictationEngine, webSpeechOptedIn, WEB_SPEECH_KEY, Segmenter, SerialQueue } from "../ai/dictation";

// SpeechRecognition is poorly + inconsistently typed across DOM lib
// variants; keep the surface deliberately loose so we don't fight the
// browser-shape soup.
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [i: number]: { transcript: string };
  }>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

/** The floating "recording" pill with a Stop button. Returns its teardown. */
function showRecordingPill(label: string, onStop: () => void): () => void {
  const host = document.createElement("div");
  host.id = "voice-recording-root";
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "hsl(var(--bg))",
          border: "1px solid hsl(var(--border-strong))",
          borderRadius: 12,
          padding: "10px 16px",
          boxShadow: "0 8px 32px hsl(0 0% 0%/0.3)",
          fontSize: 13,
          color: "hsl(var(--fg))",
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#ef4444",
            animation: "pulse 1s infinite",
          }}
        />
        <span>{label}</span>
        <button
          onClick={onStop}
          style={{
            background: "#ef4444",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "4px 12px",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          ⏹ Stop
        </button>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      </div>,
  );
  return () => {
    try {
      root.unmount();
    } catch {
      // why: already unmounted by an earlier stop
    }
    host.remove();
  };
}

type SpeechCtor = new () => SpeechRecognitionLike;
function webSpeechCtor(): SpeechCtor | null {
  const w = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return ((w.SpeechRecognition ?? w.webkitSpeechRecognition) as SpeechCtor | undefined) ?? null;
}

function localDictationSupported(): boolean {
  const w = window as Window & { webkitAudioContext?: unknown };
  return !!navigator.mediaDevices?.getUserMedia && (typeof AudioContext !== "undefined" || !!w.webkitAudioContext);
}

function appendDictated(text: string): void {
  const words = text.trim();
  if (!words) return;
  const current = useAppStore.getState().doc.content;
  useAppStore.getState().setContent(current + (current.endsWith("\n\n") || !current ? "" : "\n\n") + words);
  showAiToast(t("toast.addedWords", { count: words.split(/\s+/).length }), "info");
}

/**
 * Dictate into the open note (plan 1.3). Default: Whisper on this device, in
 * ~5-second segments. The browser speech service (which sends the audio to
 * the vendor) is used only when the policy is not local-only AND the user
 * agreed — never silently; each use is recorded in the privacy ledger.
 */
export function startVoiceRecording(lang: string): void {
  const Ctor = webSpeechCtor();
  const policy = getAiPolicy();
  const engine = chooseDictationEngine(policy, !!Ctor, webSpeechOptedIn());
  if (engine === "webspeech" && Ctor) {
    startWebSpeech(Ctor, lang);
    return;
  }
  if (localDictationSupported()) {
    void startLocalDictation(lang).catch((err) => {
      log.warn("local dictation failed", err);
      void offerWebSpeech(Ctor, lang, policy);
    });
    return;
  }
  if (!Ctor) {
    showAiToast(t("toast.speechRecognitionNotSupportedIn"), "error");
    return;
  }
  void offerWebSpeech(Ctor, lang, policy);
}

/** Local dictation is impossible here: under local-only say so (and log the block); otherwise ask. */
async function offerWebSpeech(Ctor: SpeechCtor | null, lang: string, policy: ReturnType<typeof getAiPolicy>): Promise<void> {
  if (!Ctor) {
    showAiToast(t("toast.speechRecognitionNotSupportedIn"), "error");
    return;
  }
  if (policy === "local-only") {
    recordSpeechRecognition("blocked");
    showAiToast(t("toast.dictate.localOnlyBlocked"), "error");
    return;
  }
  const { uiConfirm } = await import("./PromptDialog");
  const yes = await uiConfirm({ title: t("dictate.webSpeech.title"), message: t("dictate.webSpeech.body"), okLabel: t("dictate.webSpeech.ok") });
  if (!yes) return;
  try {
    localStorage.setItem(WEB_SPEECH_KEY, "1");
  } catch {
    // why: storage blocked — the consent then lasts for this dictation only
  }
  startWebSpeech(Ctor, lang);
}

function startWebSpeech(Ctor: SpeechCtor, lang: string): void {
  recordSpeechRecognition("allowed");
  showAiToast(t("toast.dictate.webSpeechActive"), "info");
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.continuous = true;
  let cleanup = () => {};
  const stop = () => {
    recognition.stop();
    cleanup();
    showAiToast(t("toast.recordingStopped"), "info");
  };
  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) transcript += event.results[i][0].transcript + " ";
    }
    appendDictated(transcript);
  };
  recognition.onerror = () => {
    cleanup();
    showAiToast(t("toast.speechRecognitionErrorCheckMicrophone"), "error");
  };
  recognition.onend = () => cleanup();
  cleanup = showRecordingPill(t("voice.recording", { lang }), stop);
  recognition.start();
}

/** Microphone → 5-second 16 kHz segments → Whisper in the worker → the note. Nothing leaves the device. */
async function startLocalDictation(lang: string): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = typeof AudioContext !== "undefined" ? AudioContext : (w.webkitAudioContext as typeof AudioContext);
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor works everywhere without a worklet module (which the CSP would have to allow).
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const op = aiOperation(); // Esc / "AI: Cancel" stops transcription
  const queue = new SerialQueue();
  const language = lang.split(/[-_]/)[0].toLowerCase();
  const { transcribeAudio } = await import("../ai/transformersEngine");
  const segmenter = new Segmenter({
    rate: ctx.sampleRate,
    onSegment: (seg) => {
      void queue.add(async () => {
        if (op.signal.aborted) return;
        try {
          const out = await transcribeAudio(seg, { language, signal: op.signal });
          if (typeof out.text === "string") appendDictated(out.text);
        } catch (err) {
          if (!isAbort(err)) log.warn("dictation segment failed", err);
        }
      });
    },
  });
  proc.onaudioprocess = (e) => segmenter.push(e.inputBuffer.getChannelData(0));
  source.connect(proc);
  proc.connect(ctx.destination);
  let stopped = false;
  let cleanup = () => {};
  const stop = () => {
    if (stopped) return;
    stopped = true;
    proc.disconnect();
    source.disconnect();
    stream.getTracks().forEach((tr) => tr.stop());
    segmenter.flush();
    cleanup();
    void queue.idle().finally(() => {
      op.end();
      void ctx.close();
      showAiToast(t("toast.recordingStopped"), "info");
    });
  };
  op.signal.addEventListener("abort", stop);
  cleanup = showRecordingPill(t("voice.recording", { lang }), stop);
  showAiToast(t("toast.dictate.onDevice"), "info");
}

/** The first recording container this browser supports, or "" to let MediaRecorder choose. */
export function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"]) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* some engines throw on unknown types */
    }
  }
  return "";
}

/**
 * Memo mode — record audio, Whisper-transcribe, AI-summarize, insert
 * a formatted block. Requires `MediaRecorder` (every modern browser
 * since 2016 has it).
 */
export async function startVoiceMemo(): Promise<void> {
  if (typeof MediaRecorder === "undefined") {
    showAiToast(t("toast.mediarecorderNotSupportedInThis"), "error");
    return;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    log.warn("voice memo: mic denied", err);
    showAiToast(t("toast.microphoneAccessDenied"), "error");
    return;
  }

  // Opus in webm keeps memo bytes small; Safari records mp4. Whisper (and
  // the local decoder) accept whatever the browser can produce, so the
  // first supported container wins and none is forced.
  const mimeType = pickRecordingMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    log.warn("voice memo: MediaRecorder unavailable", err);
    showAiToast(t("toast.recordingIsNotSupportedIn", { error: (err as Error).message }), "error");
    return;
  }
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });

  // Stop overlay UI mounted on document.body.
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const teardown = () => {
    try {
      root.unmount();
    } catch {
      /* */
    }
    host.remove();
    stream.getTracks().forEach((t) => t.stop());
  };

  recorder.addEventListener("stop", async () => {
    teardown();
    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: mimeType || recorder.mimeType || "audio/webm" });

    showAiToast(t("toast.transcribing"), "info");
    // Esc / "AI: Cancel" (T55) stops the transcription and the summary; nothing is inserted.
    const op = aiOperation();
    let result;
    let summary = "";
    try {
      try {
        result = await transcribe(blob, { signal: op.signal });
      } catch (err) {
        if (op.signal.aborted || isAbort(err)) return;
        log.error("voice memo transcribe failed", err);
        showAiToast(t("toast.transcribeFailed", { error: (err as Error).message }), "error");
        return;
      }

      showAiToast(t("toast.summarising"), "info");
      try {
        summary = await summarizeMemo(result.text, op.signal);
      } catch (err) {
        if (op.signal.aborted || isAbort(err)) return;
        log.warn("voice memo summary failed; inserting transcript only", err);
      }
    } finally {
      op.end();
    }

    const memo = formatVoiceMemo({
      transcript: result.text,
      summary,
      backend: result.backend,
    });
    const current = useAppStore.getState().doc.content;
    useAppStore
      .getState()
      .setContent(current + (current.endsWith("\n") ? "" : "\n") + "\n" + memo);
    showAiToast(t("toast.voiceMemoInsertedMs", { backend: result.backend, ms: Math.round(result.ms) }),
      "success",
    );
  });

  root.render(
    <div
      role="dialog"
      aria-label={t("voice.recording", { lang: "auto" })}
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "hsl(var(--bg))",
        border: "1px solid hsl(var(--border-strong))",
        borderRadius: 12,
        padding: "10px 16px",
        boxShadow: "0 8px 32px hsl(0 0% 0%/0.3)",
        fontSize: 13,
        color: "hsl(var(--fg))",
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "#ef4444",
          animation: "pulse 1s infinite",
        }}
      />
      <span>🎙 {t("voice.memo.recording") ?? "Recording memo…"}</span>
      <button
        type="button"
        onClick={() => recorder.stop()}
        style={{
          background: "#ef4444",
          color: "white",
          border: "none",
          borderRadius: 6,
          padding: "4px 12px",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {t("voice.memo.stop") ?? "⏹ Stop & insert"}
      </button>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>,
  );

  recorder.start();
}
