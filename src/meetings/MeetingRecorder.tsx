/**
 * The meeting recorder (W11.I19): one "Meeting" button — the command
 * palette and the capture box, on desktop and mobile — records, shows the
 * live transcript while people speak, and on stop writes the meeting note
 * (./meetingFlow.ts) after the user approves it. Lazy-loaded.
 *
 * Honest states: with no transcription model on this device the recorder
 * says "unavailable" and the start button is off (nothing is recorded, and
 * nothing is downloaded from here). Speakers appear only when real
 * diarization ran; without its models there is no speaker label anywhere.
 * Recording with the screen off on a phone needs the native build (W11.M10).
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./meetingFlowStrings";
import { t } from "../i18n";
import { Modal } from "../ui/Modal";
import { clock } from "../ai/dictation/longform";
import { explainError } from "../lib/userError";
import type { MeetingAvailability, MeetingDeps, MeetingResult } from "./meetingFlow";
import type { TimedFinal } from "./meetingFlowCore";
import { HelpButton } from "../ui/HelpButton";

type Phase = "checking" | "unavailable" | "idle" | "recording" | "processing" | "done" | "declined" | "error";

interface Take {
  stop(): Promise<{ audio: Blob; durationMs: number }>;
  cancel(): void;
}
interface Live {
  stop(): Promise<string | null>;
  cancel(): void;
}

export interface RecorderDeps {
  meeting: MeetingDeps;
  record(): Promise<Take>;
  /** The live engine (W10.C8), or null when none is registered or it cannot start. */
  live(o: { language?: string; onPartial: (text: string) => void; onFinal: (text: string) => void }): Promise<Live | null>;
  process: typeof import("./meetingFlow").processMeeting;
  open(path: string): void;
  now(): number;
  language?: string;
}

async function defaultDeps(): Promise<RecorderDeps> {
  const [vc, flow] = await Promise.all([import("../capture/voiceCapture"), import("./meetingFlow")]);
  return {
    meeting: flow.defaultMeetingDeps(),
    record: () => vc.startRecording(),
    live: (o) => vc.startLiveTranscript(o),
    process: flow.processMeeting,
    open: (path) => window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } })),
    now: () => performance.now(),
    language: document.documentElement.lang || undefined,
  };
}

export function MeetingRecorder({ onClose, deps }: { onClose: () => void; deps?: RecorderDeps }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [avail, setAvail] = useState<MeetingAvailability | null>(null);
  const [title, setTitle] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [partial, setPartial] = useState("");
  const [step, setStep] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState("");
  const d = useRef<RecorderDeps | null>(deps ?? null);
  const take = useRef<Take | null>(null);
  const live = useRef<Live | null>(null);
  const finals = useRef<TimedFinal[]>([]);
  const started = useRef(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        d.current ??= await defaultDeps();
        const a = await d.current.meeting.availability(d.current.language);
        if (!alive) return;
        setAvail(a);
        setPhase(a.available ? "idle" : "unavailable");
      } catch {
        if (alive) setPhase("unavailable");
      }
    })();
    return () => {
      alive = false;
      take.current?.cancel();
      live.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setElapsed((d.current!.now() - started.current) / 1000), 500);
    return () => clearInterval(id);
  }, [phase]);

  async function start() {
    const deps = d.current!;
    try {
      take.current = await deps.record();
      started.current = deps.now();
      finals.current = [];
      setPartial("");
      setDraft("");
      setMessage("");
      live.current = avail?.live
        ? await deps.live({
            language: deps.language,
            onPartial: setPartial,
            onFinal: (text) => finals.current.push({ at: (deps.now() - started.current) / 1000, text }),
          })
        : null;
      setPhase("recording");
    } catch (e) {
      take.current?.cancel();
      take.current = null;
      setPhase("error");
      setMessage(t("meetingFlow.micFailed", { error: explainError(e) }));
    }
  }

  async function stop() {
    const deps = d.current!;
    const r = take.current;
    if (!r) return;
    take.current = null;
    setPhase("processing");
    try {
      const [{ audio, durationMs }] = await Promise.all([r.stop(), live.current?.stop().catch(() => null)]);
      live.current = null;
      const res: MeetingResult = await deps.process(audio, { durationMs, finals: finals.current, title: title.trim() || t("meetingFlow.untitled"), language: deps.language, onProgress: (s) => setStep(t(`meetingFlow.${s}`)) }, deps.meeting);
      setStep("");
      if (!res.saved) {
        setPhase("declined");
        setDraft(res.markdown);
        setMessage(t("meetingFlow.declined"));
        return;
      }
      setPhase("done");
      setMessage(t("meetingFlow.done", { sentences: res.sentences, tasks: res.tasks }));
      deps.open(res.path);
    } catch (e) {
      setStep("");
      setPhase("error");
      setMessage(t("meetingFlow.failed", { error: explainError(e) }));
    }
  }

  const canStart = phase === "idle" || phase === "done" || phase === "declined" || phase === "error";
  return (
    <Modal aria-labelledby="meeting-title" onClose={phase === "processing" ? undefined : onClose} data-testid="meeting-recorder" data-phase={phase} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border-strong))", borderRadius: 12, padding: 20, width: "min(480px, 100%)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 12 }}>
        <span style={{ float: "inline-end", marginInlineStart: 8 }}><HelpButton topic="ai/meeting-notes" /></span>
        <h2 id="meeting-title" style={{ margin: 0, fontSize: 17 }}>{t("meetingFlow.title")}</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: "hsl(var(--fg-muted))" }}>{t("meetingFlow.about")}</p>
        {phase === "checking" && <p role="status">{t("meetingFlow.checking")}</p>}
        {phase === "unavailable" && (
          <p role="alert" data-testid="meeting-unavailable" style={{ margin: 0 }}>
            {t("meetingFlow.unavailable")}
          </p>
        )}
        {phase !== "checking" && phase !== "unavailable" && (
          <>
            <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
              {t("meetingFlow.name")}
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={phase === "processing" || phase === "recording"} dir="auto" />
            </label>
            <p data-testid="meeting-engines" style={{ margin: 0, fontSize: 12 }}>
              {avail?.live ? t("meetingFlow.liveOn") : t("meetingFlow.liveOff")} {avail?.diarization ? t("meetingFlow.speakersOn") : t("meetingFlow.speakersOff")}
            </p>
          </>
        )}
        {phase === "recording" && (
          <div style={{ display: "grid", gap: 8 }}>
            <div aria-live="polite" data-testid="meeting-clock" style={{ fontVariantNumeric: "tabular-nums", fontSize: 22, textAlign: "center" }}>
              ● {clock(elapsed)}
            </div>
            {avail?.live && (
              <p data-testid="meeting-live" dir="auto" aria-live="polite" style={{ margin: 0, minHeight: 40, fontSize: 13 }}>
                {partial || "…"}
              </p>
            )}
          </div>
        )}
        {phase === "processing" && <p role="status">{step || t("meetingFlow.transcribing")}</p>}
        {message && (
          <p role={phase === "error" ? "alert" : "status"} data-testid="meeting-message" style={{ margin: 0 }}>
            {message}
          </p>
        )}
        {draft && <textarea readOnly value={draft} data-testid="meeting-draft" dir="auto" rows={8} style={{ width: "100%", fontSize: 12 }} />}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {canStart ? (
            <button type="button" className="btn btn-primary" data-testid="meeting-start" onClick={() => void start()}>
              {t("meetingFlow.start")}
            </button>
          ) : phase === "recording" ? (
            <button type="button" className="btn btn-primary" data-testid="meeting-stop" onClick={() => void stop()}>
              {t("meetingFlow.stop")}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose} disabled={phase === "processing"}>
            {t("meetingFlow.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function openMeetingRecorder(deps?: RecorderDeps): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <MeetingRecorder
      deps={deps}
      onClose={() => {
        root.unmount();
        host.remove();
      }}
    />,
  );
}
