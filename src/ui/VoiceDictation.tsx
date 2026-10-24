/**
 * Voice capture (F2 / γ.4, plan 6.1).
 *
 *   - **Dictation** (`startVoiceRecording(lang)`): the engine is chosen by
 *     src/ai/dictation/engines.ts — Hebrew streams on this device
 *     (LiveDictation.tsx), other languages are recorded and transcribed on
 *     this device, and the browser's `SpeechRecognition` (audio to the
 *     browser's vendor) only when the AI policy allows the cloud; never
 *     under local-only (1.3). Its use is written to the privacy ledger.
 *   - **Memo mode** (`startVoiceMemo()`): `MediaRecorder` captures the
 *     audio, on stop we Whisper-transcribe + AI-summarize and insert a
 *     `> 🎙 Voice memo` block. It follows the AI policy — by default
 *     Whisper runs on this device through transformers.js
 *     (src/ai/transformersEngine.ts) and the summary through the local
 *     model, so no audio bytes leave the browser.
 */

import { createRoot } from "react-dom/client";
import { useAppStore } from "../store/useStore";
import { showAiToast } from "./AiToast";
import { t } from "../i18n";
import { transcribe, summarizeMemo, formatVoiceMemo } from "../ai/transcribe";
import { log } from "../lib/logger";
import { getAiPolicy } from "../ai/policy";
import { recordBrowserService } from "../ai/privacyLedger";

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

/**
 * Dictation (plan 6.1): the engine is chosen by language, hardware and the
 * AI policy (src/ai/dictation/engines.ts) — Hebrew streams on this device,
 * other languages are recorded and transcribed on this device, and the
 * browser's speech service is used only when the policy allows the cloud.
 * The live engine and its panel load on first use.
 */
export function startVoiceRecording(lang: string): void {
  void import("./LiveDictation")
    .then(({ openLiveDictation }) =>
      openLiveDictation(lang, {
        browser: () => startBrowserSpeech(lang),
        record: () => void startVoiceMemo({ language: lang, plain: true }),
      }),
    )
    .catch((err: unknown) => {
      log.error("dictation failed to start", err);
      showAiToast(t("dictation.error", { error: (err as Error).message }), "error");
    });
}

/** The browser's speech service (audio goes to its vendor): never under local-only (1.3). */
export function startBrowserSpeech(lang: string): void {
  if (getAiPolicy() === "local-only") {
    recordBrowserService("speech recognition (browser vendor)", "Browser speech recognition (Web Speech API)");
    showAiToast(t("dictation.localOnlyNoBrowser"), "error");
    return;
  }
  const SpeechRecognition =
    (window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
      .SpeechRecognition ??
    (window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
      .webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showAiToast(t("toast.speechRecognitionNotSupportedIn"), "error");
    return;
  }

  const Ctor = SpeechRecognition as new () => SpeechRecognitionLike;
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.continuous = true;

  const host = document.createElement("div");
  host.id = "voice-recording-root";
  document.body.appendChild(host);
  const root = createRoot(host);

  const cleanup = () => {
    try {
      root.unmount();
    } catch {
      /* ignore */
    }
    host.remove();
  };

  const stopRecording = () => {
    recognition.stop();
    cleanup();
    showAiToast(t("toast.recordingStopped"), "info");
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        transcript += event.results[i][0].transcript + " ";
      }
    }
    if (transcript.trim()) {
      const current = useAppStore.getState().doc.content;
      useAppStore.getState().setContent(current + "\n\n" + transcript.trim());
      showAiToast(t("toast.addedWords", { count: transcript.trim().split(/\s+/).length }), "info");
    }
  };

  recognition.onerror = () => {
    cleanup();
    showAiToast(t("toast.speechRecognitionErrorCheckMicrophone"), "error");
  };
  recognition.onend = () => cleanup();

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
      <span>{t("voice.recording", { lang })}</span>
      <button
        onClick={stopRecording}
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

  recordBrowserService("speech recognition (browser vendor)", "Browser speech recognition (Web Speech API)");
  recognition.start();
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
export async function startVoiceMemo(opts: { language?: string; plain?: boolean } = {}): Promise<void> {
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
    let result;
    try {
      // `plain` is dictation's recorded fallback: its UI promises the audio stays on this device.
      result = await transcribe(blob, { language: opts.language, local: opts.plain });
    } catch (err) {
      log.error("voice memo transcribe failed", err);
      showAiToast(t("toast.transcribeFailed", { error: (err as Error).message }), "error");
      return;
    }

    if (opts.plain) {
      // Dictation without a live engine for this language: the transcript only, at the cursor.
      const text = result.text.trim();
      if (!text) return;
      const detail = { text };
      if (window.dispatchEvent(new CustomEvent("lumen-dictation-insert", { detail, cancelable: true }))) {
        const current = useAppStore.getState().doc.content;
        useAppStore.getState().setContent(current + (current && !/\s$/.test(current) ? " " : "") + text);
      }
      return;
    }

    showAiToast(t("toast.summarising"), "info");
    let summary = "";
    try {
      summary = await summarizeMemo(result.text);
    } catch (err) {
      log.warn("voice memo summary failed; inserting transcript only", err);
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
      <span>🎙 {opts.plain ? t("dictation.localRecording") : (t("voice.memo.recording") ?? "Recording memo…")}</span>
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
