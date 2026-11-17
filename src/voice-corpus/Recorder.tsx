/**
 * The in-app voice corpus recorder (plan W7.10 step 2, W10.E52). The speaker
 * loads the script (kit.mjs script's script.tsv) and gives consent. Then they
 * read one sentence per take. Every take goes through corpus.checkTake (level,
 * clipping, background noise, silence around the speech) and is kept or redone.
 * The export is the ZIP that `kit.mjs check` and Piper's trainer read
 * (session.ts). Nothing leaves the device: no upload, and the export is a
 * file the speaker saves.
 *
 * The microphone is opened raw: no echo cancellation, noise suppression or
 * gain control. A training corpus needs the voice as it is, and checkTake
 * measures the real background. Loaded on use from the palette
 * (`voice.corpusRecorder`), never in the startup bundle.
 */
import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./recorderStrings";
import { t } from "../i18n";
import { explainError } from "../lib/userError";
import { Modal } from "../ui/Modal";
import { CONSENT_VERSION, CORPUS_RATE, addTake, exportZip, newSession, nextSentence, parseScript, sessionSummary, type Session, type Take } from "./session";
import { HelpButton } from "../ui/HelpButton";

/** A recording in progress: `stop` ends it and gives mono samples at CORPUS_RATE. */
export interface Capture {
  stop(): Promise<{ samples: Float32Array; rate: number }>;
}

export interface RecorderDeps {
  /** Opens the microphone and starts a take. */
  startCapture(): Promise<Capture>;
  /** Saves the export (a download by default). */
  save(name: string, bytes: Uint8Array): void;
  now(): Date;
}

/** Mono at `rate`: the channels averaged, resampled by the browser's own resampler (OfflineAudioContext). */
async function toMono(buf: AudioBuffer, rate: number): Promise<Float32Array> {
  const frames = Math.ceil(buf.duration * rate);
  const ctx = new OfflineAudioContext(1, Math.max(1, frames), rate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination); // a 1-channel destination down-mixes (Web Audio "speakers" rules)
  src.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}

/** The browser microphone through MediaRecorder, decoded and resampled to CORPUS_RATE. */
export async function browserCapture(): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const rec = new MediaRecorder(stream);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        rec.onstop = async () => {
          stream.getTracks().forEach((tr) => tr.stop());
          try {
            const bytes = await new Blob(parts, { type: rec.mimeType }).arrayBuffer();
            const ctx = new AudioContext();
            const decoded = await ctx.decodeAudioData(bytes);
            void ctx.close();
            resolve({ samples: await toMono(decoded, CORPUS_RATE), rate: CORPUS_RATE });
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      }),
  };
}

function download(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const DEFAULT_DEPS: RecorderDeps = { startCapture: browserCapture, save: download, now: () => new Date() };

const fmtDb = (x: number) => `${Math.round(x)} dB`;

export function CorpusRecorder({ onClose, deps = DEFAULT_DEPS }: { onClose: () => void; deps?: RecorderDeps }) {
  const [session, setSession] = useState<Session | null>(null);
  const [speaker, setSpeaker] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [last, setLast] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);

  const loadScript = useCallback(async (file: File) => {
    const lines = parseScript(await file.text());
    if (!lines.length) return setError(t("voiceCorpus.scriptEmpty"));
    const s = newSession(lines);
    setSession(s);
    setCurrent(nextSentence(s)?.id ?? null);
    setError(null);
  }, []);

  const line = useMemo(() => session?.script.find((l) => l.id === current) ?? null, [session, current]);

  const start = async () => {
    setError(null);
    setLast(null);
    try {
      setCapture(await deps.startCapture());
    } catch (e) {
      setError(t("voiceCorpus.micFailed", { error: explainError(e, "voiceCorpus") }));
    }
  };
  const stop = async () => {
    if (!capture || !session || !line) return;
    const c = capture;
    setCapture(null);
    try {
      const { samples, rate } = await c.stop();
      setLast(addTake(session, line.id, samples, rate));
      bump((n) => n + 1);
    } catch (e) {
      setError(t("voiceCorpus.micFailed", { error: explainError(e, "voiceCorpus") }));
    }
  };
  const next = () => {
    if (!session) return;
    setLast(null);
    setCurrent(nextSentence(session, current ?? undefined)?.id ?? null);
  };
  const giveConsent = () => {
    if (!session || !agreed || !speaker.trim()) return;
    session.consent = { version: CONSENT_VERSION, speaker: speaker.trim(), at: deps.now().toISOString(), licence: "CC0-1.0" };
    bump((n) => n + 1);
  };
  const doExport = () => {
    if (!session) return;
    deps.save(`lumen-voice-corpus-${deps.now().toISOString().slice(0, 10)}.zip`, exportZip(session));
  };

  const sum = session ? sessionSummary(session) : null;
  return (
    <Modal aria-label={t("voiceCorpus.title")} onClose={onClose} className="cmd-palette-backdrop" data-testid="voice-corpus-recorder">
      <div className="cmd-palette" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, fontSize: 13, maxInlineSize: 640 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ flex: 1 }}>{t("voiceCorpus.title")}</strong>
          <HelpButton topic="contributing/hebrew-voice" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("voiceCorpus.close")}>✕</button>
        </div>
        {!session && (
          <label>
            <div style={{ marginBlockEnd: 4 }}>{t("voiceCorpus.loadScript")}</div>
            <input type="file" accept=".tsv,.txt,text/tab-separated-values" data-testid="voice-corpus-script" onChange={(e) => e.target.files?.[0] && void loadScript(e.target.files[0])} />
          </label>
        )}
        {session && !session.consent && (
          <section aria-label={t("voiceCorpus.consentTitle")} data-testid="voice-corpus-consent">
            <p dir="auto" style={{ margin: 0 }}>{t("voiceCorpus.consentText")}</p>
            <p dir="auto" style={{ margin: "6px 0", color: "hsl(var(--fg-muted))", fontSize: 12 }}>{t("voiceCorpus.consentDraft")}</p>
            <label style={{ display: "block", marginBlock: 6 }}>
              {t("voiceCorpus.speaker")}{" "}
              <input dir="auto" value={speaker} onChange={(e) => setSpeaker(e.target.value)} data-testid="voice-corpus-speaker" />
            </label>
            <label style={{ display: "block" }}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="voice-corpus-agree" /> {t("voiceCorpus.agree")}
            </label>
            <button type="button" disabled={!agreed || !speaker.trim()} onClick={giveConsent} data-testid="voice-corpus-consent-ok" style={{ marginBlockStart: 8 }}>
              {t("voiceCorpus.consentOk")}
            </button>
          </section>
        )}
        {session?.consent && (
          <>
            {line ? (
              <p dir="rtl" lang="he" data-testid="voice-corpus-sentence" style={{ fontSize: 22, lineHeight: 1.5, margin: "8px 0" }}>
                {line.text}
              </p>
            ) : (
              <p data-testid="voice-corpus-done">{t("voiceCorpus.allDone")}</p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {line && !capture && (
                <button type="button" onClick={() => void start()} data-testid="voice-corpus-record">
                  {last ? t("voiceCorpus.retake") : t("voiceCorpus.record")}
                </button>
              )}
              {capture && (
                <button type="button" onClick={() => void stop()} data-testid="voice-corpus-stop">
                  {t("voiceCorpus.stop")}
                </button>
              )}
              {line && !capture && (
                <button type="button" onClick={next} data-testid="voice-corpus-next">
                  {t("voiceCorpus.next")}
                </button>
              )}
              <button type="button" onClick={doExport} disabled={!session.takes.size} data-testid="voice-corpus-export">
                {t("voiceCorpus.export")}
              </button>
            </div>
            {last && (
              <div role="status" data-testid="voice-corpus-check" data-ok={String(last.check.ok)} style={{ color: last.check.ok ? "hsl(var(--success, var(--fg)))" : "hsl(var(--warn))" }}>
                {last.check.ok ? t("voiceCorpus.takeOk") : t("voiceCorpus.takeBad", { problems: last.check.problems.map((p) => t(`voiceCorpus.problem.${p}`)).join(", ") })}
                <span style={{ color: "hsl(var(--fg-muted))" }}>
                  {" "}
                  · {t("voiceCorpus.levels", { speech: fmtDb(last.check.speechDb), noise: fmtDb(last.check.noiseDb), snr: fmtDb(last.check.snrDb) })}
                </span>
              </div>
            )}
            {sum && (
              <div data-testid="voice-corpus-summary" style={{ color: "hsl(var(--fg-muted))", fontSize: 12 }}>
                {t("voiceCorpus.summary", { ok: String(sum.ok), takes: String(sum.takes), sentences: String(session.script.length), minutes: (sum.seconds / 60).toFixed(1) })}
              </div>
            )}
          </>
        )}
        {error && (
          <div role="alert" style={{ color: "hsl(var(--danger))" }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

let close: (() => void) | null = null;

/** Open the recorder (run again to close it). */
export function openCorpusRecorder(): void {
  if (close) {
    close();
    return;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  close = () => {
    close = null;
    root.unmount();
    host.remove();
  };
  root.render(<CorpusRecorder onClose={() => close?.()} />);
}
