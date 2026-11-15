/**
 * The local meeting flow (W11.I19–I21), the app side: from the stopped
 * recording to the meeting note, on this device.
 *
 *   transcript  the live engine's timed sentences (W10.C8: the Zipformer
 *               dictation registered at startup), then — when a Whisper
 *               model is already in the browser — a timed Whisper pass that
 *               replaces them (W1.17's correction); with no live transcript,
 *               the downloaded Zipformer for Hebrew (#661, W11.H7) or the
 *               cached Whisper. Nothing is downloaded here: with no model on
 *               this device the recorder says "unavailable" and never starts.
 *   summary     the checked lecture summarizer (W10.C9: local models only,
 *               every sentence copied from the transcript), else extractive
 *   notes       the meeting writer on local executors only (Ollama, then
 *               the in-browser model); every item checked against the
 *               transcript (meetingFlowCore.checkNotes), the rest dropped
 *   speakers    only from real diarization (pyannote ONNX behind the W2.7
 *               seam, pinned models); otherwise the note has no labels
 *   saving      the note and its tasks come from the transcript — outside
 *               content — so writing them asks first (the Rule of Two,
 *               agents/untrusted.askUntrusted, the dialog agent writes from
 *               outside content get; W11.I2 (#692) also lists each answer
 *               in the privacy log). Declined: nothing is written.
 */
import "./meetingFlowStrings";
import { t } from "../i18n";
import { normalizeNotes, type MeetingNotes } from "./meetingCore";
import { checkNotes, meetingNote, meetingPaths, meetingSentences, segmentsOfFinals, type TimedFinal } from "./meetingFlowCore";
import { extractiveSummary, verifySummary } from "../student/lectureCore";
import type { Sentence } from "../ai/dictation/longform";
import type { UntrustedConsentRequest } from "../agents/types";

/** Where a meeting transcript came from (shown in the note's frontmatter). */
export type TranscriptEngine = "zipformer-live" | "zipformer-file" | "whisper";

/** What is on this device for a meeting. `available` false: the recorder shows "unavailable" and records nothing. */
export interface MeetingAvailability {
  live: boolean;
  zipformer: boolean;
  /** A Whisper model id already in the browser's cache, or null. */
  whisper: string | null;
  diarization: boolean;
  available: boolean;
}

export const TRANSCRIPT_SOURCE = "meeting transcript (microphone recording on this device)";

export interface MeetingDeps {
  availability(language?: string): Promise<MeetingAvailability>;
  /** A timed transcript of the recording after it stopped (local only), or null. */
  transcribe(audio: Blob, o: { language?: string; durationSec: number; availability: MeetingAvailability; signal?: AbortSignal }): Promise<{ segments: Sentence[]; engine: TranscriptEngine } | null>;
  /** Summary sentence indices (checked summarizer); rejects without a local model. */
  summarize(sentences: readonly Sentence[], signal?: AbortSignal): Promise<number[]>;
  /** The meeting writer's raw notes (local model); rejects without one. */
  notes(transcript: string, o: { date: string; signal?: AbortSignal }): Promise<MeetingNotes>;
  /** One speaker per sentence from real diarization, or null (not available, declined, failed). */
  speakers(audio: Blob, sentences: readonly Sentence[], signal?: AbortSignal): Promise<Array<string | null> | null>;
  consent(req: UntrustedConsentRequest): Promise<boolean>;
  write(paths: { note: string; audio: string }, audio: Blob, markdown: string): Promise<void>;
}

export interface MeetingResult {
  saved: boolean;
  path: string;
  markdown: string;
  sentences: number;
  tasks: number;
  rejected: number;
  summary: "checked" | "extractive";
  engine: TranscriptEngine;
  speakers: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The transcript the meeting writer reads: one sentence per line with its time. */
export function writerTranscript(sentences: readonly Sentence[], speakers?: ReadonlyArray<string | null>): string {
  return sentences.map((s, i) => `${speakers?.[i] ? `${speakers[i]}: ` : ""}${s.text}`).join("\n");
}

export async function processMeeting(
  audio: Blob,
  o: { durationMs: number; finals: readonly TimedFinal[]; title: string; language?: string; when?: Date; signal?: AbortSignal; onProgress?: (step: "transcribing" | "summarizing" | "saving") => void },
  deps: MeetingDeps,
): Promise<MeetingResult> {
  const when = o.when ?? new Date();
  const durationSec = o.durationMs / 1000;
  const availability = await deps.availability(o.language);
  o.onProgress?.("transcribing");
  let segments = segmentsOfFinals(o.finals, durationSec);
  let engine: TranscriptEngine = "zipformer-live";
  const after = await deps.transcribe(audio, { language: o.language, durationSec, availability, signal: o.signal }).catch((e) => {
    if ((e as Error)?.name === "AbortError") throw e;
    return null;
  });
  // A timed Whisper pass replaces the live text (W1.17); a file pass only fills in when nothing was heard live.
  if (after?.segments.length && (after.engine === "whisper" || !segments.length)) ({ segments, engine } = after);
  const sentences = meetingSentences(segments);
  if (!sentences.length) throw new Error(t("meetingFlow.empty"));

  o.onProgress?.("summarizing");
  const speakers = availability.diarization ? await deps.speakers(audio, sentences, o.signal).catch(() => null) : null;
  let summary = extractiveSummary(sentences, new Set());
  let kind: MeetingResult["summary"] = "extractive";
  const picked = await deps.summarize(sentences, o.signal).catch(() => null);
  if (picked?.length && picked.every((i) => sentences[i]) && verifySummary(picked.map((i) => sentences[i].text), sentences.map((s) => s.text).join(" "))) {
    summary = picked;
    kind = "checked";
  }
  const date = iso(when);
  const raw = await deps.notes(writerTranscript(sentences, speakers ?? undefined), { date, signal: o.signal }).catch((e) => {
    if ((e as Error)?.name === "AbortError") throw e;
    return null;
  });
  const checked = checkNotes(raw ? normalizeNotes(raw) : { decisions: [], tasks: [], questions: [] }, sentences);
  const paths = meetingPaths(when, o.title, audio.type);
  const markdown = meetingNote(
    { title: o.title, date, audioLink: paths.audioLink, durationSec, sentences, summary, notes: checked, speakers: speakers ?? undefined, engine },
    {
      recording: t("meetingFlow.note.recording"),
      summary: t("meetingFlow.note.summary"),
      summaryKind: t(kind === "checked" ? "meetingFlow.note.summaryChecked" : "meetingFlow.note.summaryExtractive"),
      decisions: t("meetingFlow.note.decisions"),
      tasks: t("meetingFlow.note.tasks"),
      questions: t("meetingFlow.note.questions"),
      none: raw ? t("meetingFlow.note.none") : t("meetingFlow.note.noModel"),
      transcript: t("meetingFlow.note.transcript"),
      rejected: checked.rejected.length ? t("meetingFlow.note.rejected", { n: checked.rejected.length }) : null,
    },
  );
  const result: MeetingResult = { saved: false, path: paths.note, markdown, sentences: sentences.length, tasks: checked.tasks.length, rejected: checked.rejected.length, summary: kind, engine, speakers: new Set((speakers ?? []).filter(Boolean)).size };

  // The Rule of Two: what the transcript produced is written only after the user says so.
  o.onProgress?.("saving");
  const ok = await deps.consent({ tool: "meeting.save", scope: "write", args: { path: paths.note, tasks: checked.tasks.length, decisions: checked.decisions.length }, sources: [TRANSCRIPT_SOURCE] });
  if (!ok) return result;
  await deps.write(paths, audio, markdown);
  return { ...result, saved: true };
}

/* ─── This device's engines ────────────────────────────────────────── */

/** Whisper models the flow may use, best for Hebrew first (ids as transformers.js caches them). */
export const WHISPER_IDS = ["itayinbar/Ozen-v1", "ivrit-ai/whisper-large-v3-turbo-onnx", "onnx-community/whisper-large-v3-turbo", "onnx-community/whisper-small", "onnx-community/whisper-base", "onnx-community/whisper-tiny"] as const;

/** The best Whisper model whose weights are in the cache (URLs of "transformers-cache"), or null. */
export function cachedWhisper(urls: readonly string[], language?: string): string | null {
  const he = (language ?? "").toLowerCase().startsWith("he");
  // Ozen is Hebrew only.
  const ids = he ? WHISPER_IDS : WHISPER_IDS.filter((id) => id !== "itayinbar/Ozen-v1");
  return ids.find((id) => urls.some((u) => u.includes(`/${id}/`) && /\.onnx(\?|$)/.test(u))) ?? null;
}

async function availability(language?: string): Promise<MeetingAvailability> {
  const [{ hasLiveTranscriber }, store, { diarizationAvailable }] = await Promise.all([import("../capture/voiceCapture"), import("../ai/dictation/modelStore"), import("./diarizeModels")]);
  const zipformer = await store.isDictationModelDownloaded().catch(() => false);
  let urls: string[] = [];
  try {
    if (typeof caches !== "undefined") urls = (await (await caches.open("transformers-cache")).keys()).map((r) => r.url);
  } catch {
    /* why: no Cache Storage (private mode): no cached Whisper */
  }
  const he = (language ?? "he").toLowerCase().startsWith("he");
  const live = hasLiveTranscriber() && he;
  const whisper = cachedWhisper(urls, language);
  return { live, zipformer: zipformer && he, whisper, diarization: diarizationAvailable(), available: live || (zipformer && he) || !!whisper };
}

const appDeps: MeetingDeps = {
  availability,
  async transcribe(audio, { language, durationSec, availability: a, signal }) {
    const engine = await import("../ai/transformersEngine");
    const samples = await engine.decodeAudioTo16k(audio);
    if (!samples.length) return null;
    if (a.whisper) {
      const lang = language ? language.split(/[-_]/)[0].toLowerCase() : undefined;
      const out = await engine.transcribeAudio(samples, { language: lang, model: a.whisper, signal, timestamps: true });
      const segs = out.segments?.length ? out.segments : out.text ? [{ start: 0, end: durationSec, text: out.text }] : [];
      return { segments: segs, engine: "whisper" };
    }
    if (a.zipformer) {
      const [store, he] = await Promise.all([import("../ai/dictation/modelStore"), import("../ai/dictation/fileTranscriber")]);
      const files = await store.loadDictationFiles(undefined, signal);
      const worker = new Worker(new URL("../ai/dictation/dictation.worker.ts", import.meta.url), { type: "module" });
      const text = await he.transcribeSamples(samples, files, { worker, ortBase: engine.ortBaseUrl(), signal });
      // No word times from this pass: one segment, cut into ≤ 60 s lines by length.
      return text ? { segments: [{ start: 0, end: durationSec, text }], engine: "zipformer-file" } : null;
    }
    return null;
  },
  async summarize(sentences, signal) {
    const { checkedLectureSummarizer, languageName } = await import("../student/lectureSummarizer");
    return checkedLectureSummarizer(undefined, languageName(document.documentElement.lang || undefined))(sentences, new Set(), signal);
  },
  async notes(transcript, { date, signal }) {
    const [{ runAgentOrThrow }, { meetingWriterAgent }] = await Promise.all([import("../agents/runtime"), import("../agents/defs")]);
    // Local executors only: a meeting never goes to a cloud model from here. The transcript is outside content.
    return runAgentOrThrow({ ...meetingWriterAgent, executorPreference: ["ollama", "webllm"] }, { text: transcript, extra: { date } }, { signal, document: transcript, ownPrompt: true, untrusted: [TRANSCRIPT_SOURCE] });
  },
  async speakers(audio, sentences, signal) {
    const [{ diarizeRecording }, { assignSpeakers }, engine] = await Promise.all([import("./meetingTranscribe"), import("./diarize"), import("../ai/transformersEngine")]);
    const turns = await diarizeRecording(await engine.decodeAudioTo16k(audio), signal);
    return turns?.length ? assignSpeakers(sentences, turns).map((s) => s.speaker) : null;
  },
  async consent(req) {
    const { askUntrusted } = await import("../agents/untrusted");
    return askUntrusted(undefined, req);
  },
  async write(paths, audio, markdown) {
    const [{ writeWorkspaceBlob, writeWorkspaceFile }, { notifyWorkspaceChanged }] = await Promise.all([import("../storage/workspace"), import("../storage/workspaceEvents")]);
    await writeWorkspaceBlob(paths.audio, audio);
    await writeWorkspaceFile(paths.note, markdown);
    notifyWorkspaceChanged({ kind: "structure", paths: [paths.audio, paths.note] });
  },
};

export function defaultMeetingDeps(): MeetingDeps {
  return appDeps;
}
