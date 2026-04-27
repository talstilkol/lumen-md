import { createRoot } from "react-dom/client";
import { useAppStore } from "../store/useStore";
import { showAiToast } from "./AiToast";

export function startVoiceRecording(lang: string) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showAiToast("Speech recognition not supported in this browser", "error");
    return;
  }

  const recognition = new SpeechRecognition();
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

  recognition.onresult = (event: any) => {
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
      <span>Recording... ({lang})</span>
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
    </div>
  );

  recognition.start();
}
