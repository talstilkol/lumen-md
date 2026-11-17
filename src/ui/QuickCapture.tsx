/**
 * The quick-capture box (plan 4.16): one text field, Enter adds it to the
 * end of inbox.md (Shift+Enter starts a new line), Esc closes. Opened by
 * ⌥⌘N, the command palette, the installed app's "Quick capture" shortcut
 * (`/?capture=1`) and the desktop menu — two steps from anywhere: open,
 * type, Enter. Loaded lazily.
 *
 * Plan W1.13: the microphone button records a voice note on this device;
 * when it stops, the transcript fills the box (to edit before adding) and,
 * with "Keep the recording", the audio is saved under attachments/ and
 * linked from the entry. `/?capture=voice` opens the box already recording
 * (the installed app's "Voice note" shortcut, iOS Shortcuts, an Android
 * home-screen shortcut).
 */

import { useEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import "../capture/strings";
import { t } from "../i18n";
// The capture itself (../capture/quickCapture) loads on use, like ../capture/voiceCapture.
const captureMod = () => import("../capture/quickCapture");
import { isOPFSAvailable } from "../storage/workspace";
import { toast } from "../store/useToastStore";
import "./PromptDialog.css";
import { tapReady } from "../mobile/nativeActions";
import { log } from "../lib/logger";
import { HelpButton } from "./HelpButton";
import { explainError } from "../lib/userError";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Start recording as soon as the box opens (`/?capture=voice`). */
  voice?: boolean;
}

type VoiceState = { kind: "idle" } | { kind: "starting" } | { kind: "recording"; since: number } | { kind: "transcribing" };
type VoiceModule = typeof import("../capture/voiceCapture");
type Recording = import("../capture/voiceCapture").Recording;
/** The iOS app (Capacitor), where the capture Live Activity exists. */
const isIosApp = () => {
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  return !!c?.isNativePlatform?.() && c.getPlatform?.() === "ios";
};
type LiveTranscript = import("../capture/voiceCapture").LiveTranscript;

export function QuickCapture({ open, onClose, voice: voiceOnOpen }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [voice, setVoice] = useState<VoiceState>({ kind: "idle" });
  const [keepAudio, setKeepAudio] = useState(false);
  const [now, setNow] = useState(0);
  /** The live engine's text while recording (W10.C8), and whether there is none (then: after the recording). */
  const [partial, setPartial] = useState("");
  const [afterStop, setAfterStop] = useState(false);
  const rec = useRef<Recording | null>(null);
  const live = useRef<Promise<LiveTranscript | null> | null>(null);
  /** The last recording (kept until the capture is added), and whether its transcript failed. */
  const take = useRef<{ audio: Blob; durationMs: number; untranscribed: boolean } | null>(null);
  const mod = useRef<Promise<VoiceModule> | null>(null);
  /** W13.M2: the Lock Screen / Dynamic Island activity (the iOS app only). */
  const act = useRef<import("../mobile/liveActivity").CaptureActivity | null>(null);
  const voiceMod = () => (mod.current ??= import("../capture/voiceCapture"));

  const startVoice = async () => {
    const pressed = performance.now();
    setVoice({ kind: "starting" });
    try {
      const m = await voiceMod();
      rec.current = await m.startRecording(pressed);
      const since = Date.now();
      setVoice({ kind: "recording", since });
      act.current?.recording(true, since);
      // The live engine listens alongside the recording; without one, Whisper transcribes after it (and the box says so).
      setPartial("");
      setAfterStop(!m.hasLiveTranscriber());
      const started = m.startLiveTranscript({ language: document.documentElement.lang || undefined, onPartial: setPartial });
      live.current = started;
      void started.then((l: LiveTranscript | null) => {
        if (!l && live.current === started) setAfterStop(true);
      });
    } catch {
      setVoice({ kind: "idle" });
      toast.error(t("capture.voice.noMic"));
    }
  };

  const stopVoice = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    act.current?.recording(false);
    const pendingLive = live.current;
    live.current = null;
    setVoice({ kind: "transcribing" });
    const { audio, durationMs } = await r.stop();
    let transcript: string | null = null;
    try {
      transcript = (await (await pendingLive)?.stop()) ?? null;
    } catch {
      transcript = null;
    }
    if (!transcript) {
      try {
        const m = await voiceMod();
        transcript = await m.transcribeVoice(audio, { language: document.documentElement.lang || undefined });
      } catch {
        transcript = null;
      }
    }
    setPartial("");
    setAfterStop(false);
    take.current = { audio, durationMs, untranscribed: !transcript };
    if (!transcript) {
      // Nothing to read back: keep the audio, or the note would be lost.
      setKeepAudio(true);
      toast.error(t("capture.voice.noTranscript"));
    }
    setText((prev) => [prev.trim(), transcript ?? ""].filter(Boolean).join("\n"));
    setVoice({ kind: "idle" });
    ref.current?.focus();
  };

  useEffect(() => {
    if (voice.kind !== "recording") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [voice.kind]);

  useEffect(() => {
    if (open && voiceOnOpen) void startVoice();
    return () => {
      rec.current?.cancel();
      void live.current?.then((l: LiveTranscript | null) => l?.cancel());
      live.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, voiceOnOpen]);

  // W13.M2: while the box is open in the iOS app, a Live Activity keeps it in reach; its Stop button stops the recording.
  useEffect(() => {
    if (!open || !isIosApp()) return;
    let off: (() => void) | undefined;
    let alive = true;
    void import("../mobile/liveActivity").then(async (m) => {
      const a = await m.captureActivity();
      if (!alive) return;
      act.current = a;
      if (rec.current) a.recording(true);
      else a.opened();
      off = a.onStop(() => {
        if (rec.current) void stopVoice();
      });
    });
    return () => {
      alive = false;
      off?.();
      act.current?.closed();
      act.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    // Plan W3.4: a widget tap → the cursor here; the time is kept locally for the < 1 s check.
    const ms = tapReady();
    if (ms !== null) log.info("widget tap → typing", `${ms} ms`);
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  // No closing while a save is pending: the save closes the box when it
  // lands, and must not close a box reopened meanwhile (review #268).
  const close = () => {
    if (!busy) onClose();
  };

  const save = async () => {
    const voiceTake = take.current;
    if (busy || voice.kind !== "idle" || (!text.trim() && !voiceTake)) return;
    if (!isOPFSAvailable()) {
      toast.error(t("capture.noWorkspace"));
      return;
    }
    setBusy(true);
    try {
      if (voiceTake && (keepAudio || voiceTake.untranscribed)) {
        const m = await voiceMod();
        await m.captureVoice(text.trim() || null, { placeholder: t("capture.voice.placeholderNote"), audio: voiceTake.audio, durationMs: voiceTake.durationMs });
      } else {
        // A message pasted from WhatsApp or Telegram keeps its app, author and time (plan W5.7).
        const { chatShareText } = await import("../capture/chats/share");
        await (await captureMod()).captureToInbox(chatShareText(text) ?? text);
      }
      take.current = null;
      setText("");
      act.current?.saved();
      toast.success(t("capture.saved", { path: (await captureMod()).INBOX_PATH }));
      onClose();
    } catch (e) {
      toast.error(t("capture.failed", { error: explainError(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={close}
      className="prompt-backdrop"
      aria-labelledby="quick-capture-title"
      data-testid="quick-capture"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="prompt-dialog" style={{ width: "min(480px, calc(100vw - 32px))" }}>
        <div id="quick-capture-title" className="prompt-title" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Inbox size={16} aria-hidden="true" />
          {t("capture.title")}
        </div>
        <HelpButton topic="workspace/quick-capture" />
        <textarea
          ref={ref}
          className="prompt-input"
          dir="auto"
          rows={3}
          value={text}
          // Saving: what's typed now would be lost when the box clears (review #268).
          readOnly={busy}
          aria-busy={busy}
          aria-label={t("capture.title")}
          placeholder={t("capture.placeholder")}
          style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
        />
        <div className="prompt-message" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="prompt-btn prompt-btn-cancel"
            data-testid="capture-voice"
            data-state={voice.kind}
            disabled={busy || voice.kind === "starting" || voice.kind === "transcribing"}
            aria-pressed={voice.kind === "recording"}
            aria-label={t("capture.voice.start")}
            onClick={() => void (voice.kind === "recording" ? stopVoice() : startVoice())}
            style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
          >
            <span aria-hidden="true">{voice.kind === "recording" ? "■" : "●"}</span>
            {voice.kind === "recording"
              ? t("capture.voice.recording", { time: `${Math.floor(Math.max(0, now - voice.since) / 60000)}:${String(Math.floor((Math.max(0, now - voice.since) / 1000) % 60)).padStart(2, "0")}` })
              : voice.kind === "transcribing"
                ? t("capture.voice.transcribing")
                : t("capture.voice.start")}
          </button>
          <button
            type="button"
            className="prompt-btn prompt-btn-cancel"
            data-testid="capture-meeting"
            disabled={busy || voice.kind !== "idle"}
            onClick={() => {
              // W11.I19: the meeting recorder, from the capture box (desktop and mobile).
              close();
              void import("../meetings/MeetingRecorder").then((m) => m.openMeetingRecorder());
            }}
          >
            {t("capture.meeting")}
          </button>
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12 }}>
            <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} data-testid="capture-keep-audio" />
            {t("capture.voice.keepAudio")}
          </label>
          <span style={{ flex: 1 }}>{t("capture.hint")}</span>
        </div>
        {voice.kind === "recording" && partial ? (
          <p className="prompt-message" dir="auto" aria-live="polite" data-testid="capture-voice-partial" style={{ margin: 0, opacity: 0.8 }}>
            {partial}
          </p>
        ) : null}
        {voice.kind === "recording" && afterStop ? (
          <p className="prompt-message" data-testid="capture-voice-after-stop" style={{ margin: 0, fontSize: 12 }}>
            {t("capture.voice.afterStop")}
          </p>
        ) : null}
        <div className="prompt-actions">
          <button
            type="button"
            className="prompt-btn prompt-btn-cancel"
            disabled={busy}
            onClick={() => {
              onClose();
              void captureMod()
                .then((m) => m.openInbox())
                .catch((e: unknown) => toast.error(t("capture.failed", { error: explainError(e) })));
            }}
          >
            {t("capture.openInbox")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-cancel" disabled={busy} onClick={close}>
            {t("dialog.cancel")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-ok" disabled={busy || voice.kind !== "idle" || (!text.trim() && !take.current)} onClick={() => void save()} data-testid="capture-save">
            {t("capture.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
