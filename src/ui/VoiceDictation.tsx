/**
 * Voice memo capture (F2 / γ.4).
 *
 * Two flows live behind the same UI:
 *   - **Quick mode** (default): Browser-native `SpeechRecognition`,
 *     interim results streamed straight into the editor. Same as the
 *     old behaviour — fast, no AI cost, no audio recording.
 *   - **Memo mode** (when `aiKey` is set OR Privacy Mode is on):
 *     `MediaRecorder` captures the audio, on stop we Whisper-transcribe
 *     + AI-summarize and insert a `> 🎙 Voice memo` block at the cursor.
 *
 * The memo flow honours Privacy Mode — `useLocalAi=true` routes
 * Whisper through `@xenova/transformers` and the summary through
 * web-llm, so no audio bytes leave the browser.
 *
 * Backwards-compat: `startVoiceRecording(lang)` is the legacy entry
 * point and still defaults to quick mode. The new `startVoiceMemo()`
 * wraps the AI flow.
 */

import { createRoot } from "react-dom/client";
import { useAppStore } from "../store/useStore";
import { showAiToast } from "./AiToast";
import { t } from "../i18n";
import { transcribe, summarizeMemo, formatVoiceMemo } from "../ai/transcribe";
import { log } from "../lib/logger";

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

export function startVoiceRecording(lang: string): void {
  const SpeechRecognition =
    (window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
      .SpeechRecognition ??
    (window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
      .webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showAiToast("Speech recognition not supported in this browser", "error");
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
    showAiToast("🎙 Recording stopped", "info");
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
      showAiToast(`✅ Added ${transcript.trim().split(/\s+/).length} words`, "info");
    }
  };

  recognition.onerror = () => {
    cleanup();
    showAiToast("Speech recognition error — check microphone permissions", "error");
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

  recognition.start();
}

/**
 * Memo mode — record audio, Whisper-transcribe, AI-summarize, insert
 * a formatted block. Requires `MediaRecorder` (every modern browser
 * since 2016 has it).
 */
export async function startVoiceMemo(): Promise<void> {
  if (typeof MediaRecorder === "undefined") {
    showAiToast("MediaRecorder not supported in this browser", "error");
    return;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    log.warn("voice memo: mic denied", err);
    showAiToast("Microphone access denied", "error");
    return;
  }

  // Use opus to keep memo bytes small. Whisper accepts webm.
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType });
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
    const blob = new Blob(chunks, { type: mimeType });

    showAiToast("🎙 Transcribing…", "info");
    let result;
    try {
      result = await transcribe(blob);
    } catch (err) {
      log.error("voice memo transcribe failed", err);
      showAiToast(`Transcribe failed: ${(err as Error).message}`, "error");
      return;
    }

    showAiToast("✨ Summarising…", "info");
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
    showAiToast(
      `✅ Voice memo inserted (${result.backend}, ${Math.round(result.ms)} ms)`,
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
