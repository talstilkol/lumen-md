/**
 * The in-app corpus recorder's state (plan W7.10 step 2, W10.E52): the
 * script, one checked take per sentence, and the export the CLI kit and
 * Piper's trainer read. Pure: the recorder component (Recorder.tsx) does the
 * audio and passes mono samples in.
 *
 * The export is one ZIP (stored, not compressed: WAV barely compresses):
 *   script.tsv     the script as loaded (id \t text \t source), what `kit.mjs check` reads
 *   wavs/<id>.wav  every kept take, 16-bit mono at the take's rate (22,050 Hz from the recorder)
 *   metadata.csv   LJSpeech `id|text|text`, passing takes only (corpus.ljspeechMetadata)
 *   manifest.json  rate, licence (CC0-1.0), the consent the speaker gave, each take's check, the summary
 */
import { checkTake, ljspeechMetadata, summary, wav, type CorpusSummary, type TakeCheck } from "./corpus";
import { storedZip } from "./zipStore";

/** Piper trains at 22,050 Hz (corpus.wav). */
export const CORPUS_RATE = 22_050;

export interface ScriptLine {
  id: string;
  text: string;
  source: string;
}

export interface Take {
  id: string;
  samples: Float32Array;
  rate: number;
  check: TakeCheck;
  seconds: number;
}

/** The consent a speaker gives before the first take (its text: voiceCorpus.consent.* in src/i18n). */
export interface Consent {
  /** The consent text's version: a changed text is a new version, and older takes keep theirs. */
  version: string;
  /** The speaker's name or pseudonym, as they want it credited. */
  speaker: string;
  at: string;
  licence: "CC0-1.0";
}
export const CONSENT_VERSION = "2026-11-15-draft";

/** script.tsv (kit.mjs script's output): id \t text \t source, one per line. Blank and malformed lines are skipped. */
export function parseScript(tsv: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  const seen = new Set<string>();
  for (const line of tsv.split(/\r?\n/)) {
    const [id, text, source = ""] = line.split("\t");
    if (!id?.trim() || !text?.trim() || seen.has(id.trim())) continue;
    seen.add(id.trim());
    out.push({ id: id.trim(), text: text.trim(), source: source.trim() });
  }
  return out;
}

export interface Session {
  script: ScriptLine[];
  consent: Consent | null;
  takes: Map<string, Take>;
}

export const newSession = (script: ScriptLine[]): Session => ({ script, consent: null, takes: new Map() });

/** Check a take and keep it for its sentence (a retake replaces it). Refused before consent. */
export function addTake(s: Session, id: string, samples: Float32Array, rate: number): Take {
  if (!s.consent) throw new Error("voice corpus: no take before the speaker's consent");
  if (!s.script.some((l) => l.id === id)) throw new Error(`voice corpus: ${id} is not in the script`);
  const take: Take = { id, samples, rate, check: checkTake(samples, rate), seconds: samples.length / rate };
  s.takes.set(id, take);
  return take;
}

/** The first sentence with no passing take, from `after` on (wrapping), or null when every sentence has one. */
export function nextSentence(s: Session, after?: string): ScriptLine | null {
  const start = after ? s.script.findIndex((l) => l.id === after) + 1 : 0;
  for (let k = 0; k < s.script.length; k++) {
    const l = s.script[(start + k) % s.script.length];
    if (!s.takes.get(l.id)?.check.ok) return l;
  }
  return null;
}

export const sessionSummary = (s: Session): CorpusSummary => summary([...s.takes.values()].map((t) => ({ ok: t.check.ok, seconds: t.seconds })));

export interface Manifest {
  format: "lumen-voice-corpus/1";
  rate: number;
  licence: "CC0-1.0";
  consent: Consent;
  summary: CorpusSummary;
  takes: Array<{ id: string; seconds: number; ok: boolean; problems: TakeCheck["problems"]; speechDb: number; noiseDb: number; snrDb: number; peakDb: number }>;
}

/** The export's files, by path (what the ZIP holds). */
export function exportFiles(s: Session): Map<string, Uint8Array> {
  if (!s.consent) throw new Error("voice corpus: nothing to export without the speaker's consent");
  const enc = new TextEncoder();
  const takes = s.script.map((l) => s.takes.get(l.id)).filter((t): t is Take => !!t);
  const manifest: Manifest = {
    format: "lumen-voice-corpus/1",
    rate: takes[0]?.rate ?? CORPUS_RATE,
    licence: "CC0-1.0",
    consent: s.consent,
    summary: sessionSummary(s),
    takes: takes.map((t) => ({ id: t.id, seconds: Math.round(t.seconds * 100) / 100, ok: t.check.ok, problems: t.check.problems, speechDb: round1(t.check.speechDb), noiseDb: round1(t.check.noiseDb), snrDb: round1(t.check.snrDb), peakDb: round1(t.check.peakDb) })),
  };
  const files = new Map<string, Uint8Array>();
  files.set("script.tsv", enc.encode(s.script.map((l) => `${l.id}\t${l.text}\t${l.source}`).join("\n") + "\n"));
  files.set("metadata.csv", enc.encode(ljspeechMetadata(takes.map((t) => ({ id: t.id, text: s.script.find((l) => l.id === t.id)!.text, ok: t.check.ok })))));
  files.set("manifest.json", enc.encode(JSON.stringify(manifest, null, 2) + "\n"));
  for (const t of takes) files.set(`wavs/${t.id}.wav`, wav(t.samples, t.rate));
  return files;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The export as one stored ZIP. */
export const exportZip = (s: Session): Uint8Array => storedZip(exportFiles(s));
