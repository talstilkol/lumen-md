#!/usr/bin/env node
/**
 * Plan W5.13 acceptance on a real machine: a 90-minute lecture processed
 * end to end in ≤ 20 minutes on a laptop with a GPU, every card linked to
 * its moment, and 0 network requests.
 *
 *   LUMEN_ASR_CMD='whisper-cli -m models/ggml-ivrit-ai-whisper-large-v3-turbo.bin -l he -oj -of {out} -f {in}' \
 *   LUMEN_SUMMARY_MODEL=qwen2.5:7b \
 *   node scripts/student/lecture-timing.mjs --audio lecture.m4a [--markers 600,1800,3600] [--out report.json]
 *
 * The stages, each timed (the app's lecture pipeline, src/student/lectureCore.ts):
 *   decode      ffmpeg → 16 kHz mono WAV
 *   transcribe  LUMEN_ASR_CMD (whisper.cpp with -oj: segments with offsets; the
 *               desktop's engine, on the GPU through Metal)
 *   sentences   sentencesOf (a ▶ per sentence), importantOf (the markers)
 *   summary     the checked summarizer (src/student/lectureSummarizer.ts) over a
 *               local Ollama model (LUMEN_SUMMARY_MODEL, loopback only); the
 *               extractive summary when the check refuses it
 *   cards       cardsFrom + the note (lectureNote)
 *
 * Network: every fetch the run makes is counted; anything not on loopback
 * fails the run. Exit 0 when total ≤ 20 min, every card has a #t= link and
 * there were 0 non-local requests; 1 otherwise; 3 when a tool is missing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TARGET_MS = 20 * 60_000;

const quote = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

/** whisper.cpp's -oj JSON → timed segments (seconds). */
export function parseWhisperJson(json) {
  const list = (typeof json === "string" ? JSON.parse(json) : json)?.transcription ?? [];
  return list.map((s) => ({ start: (s.offsets?.from ?? 0) / 1000, end: (s.offsets?.to ?? 0) / 1000, text: String(s.text ?? "").trim() })).filter((s) => s.text);
}

export const isLoopback = (url) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "::1" || h === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
};

/** A fetch that counts requests and refuses (and records) any that leave the machine. */
export function guardedFetch(inner = globalThis.fetch) {
  const log = { local: 0, remote: [] };
  const f = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (!isLoopback(url)) {
      log.remote.push(url);
      throw new Error(`network request off this machine refused: ${url}`);
    }
    log.local++;
    return inner(input, init);
  };
  return { fetch: f, log };
}

/** A SummaryRun on a local Ollama: the summarizer agent's job (n sentences, copied from the text). */
export function ollamaSummary({ url, model, fetchImpl }) {
  return async (text, { language, sentences, signal }) => {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, think: false, options: { temperature: 0, seed: 42 }, messages: [{ role: "system", content: `Summarise the lecture in ${language} in at most ${sentences} sentences. Copy each sentence word for word from the lecture; add nothing. One sentence per line.` }, { role: "user", content: text }] }),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
    return String((await res.json())?.message?.content ?? "");
  };
}

/**
 * The pipeline with timings. deps: { decode(), transcribe() → segments,
 * core (lectureCore), summarize(sentences, important) → indices | throws,
 * now() }.
 */
export async function timeLecture(deps, { markers = [], audioPath = "Lectures/lecture.m4a", title = "lecture" } = {}) {
  const t = {};
  const now = deps.now ?? (() => performance.now());
  const stage = async (name, fn) => {
    const s = now();
    const v = await fn();
    t[name] = Math.round(now() - s);
    return v;
  };
  const wav = await stage("decode", () => deps.decode());
  const segments = await stage("transcribe", () => deps.transcribe(wav));
  const { sentences, important } = await stage("sentences", () => {
    const sentences = deps.core.sentencesOf(segments);
    return { sentences, important: deps.core.importantOf(sentences, markers) };
  });
  let summaryKind = "checked";
  const summary = await stage("summary", async () => {
    try {
      const idx = await deps.summarize(sentences, important);
      if (idx.length) return idx;
    } catch {
      /* why: the check refused the model's summary, or the model failed: the app falls back the same way */
    }
    summaryKind = "extractive";
    return deps.core.extractiveSummary(sentences, important);
  });
  const cards = await stage("cards", () => deps.core.cardsFrom(sentences, important, audioPath));
  const durationSec = segments.at(-1)?.end ?? 0;
  const note = deps.core.lectureNote({ title, date: "2026-01-01", audioPath, durationSec, sentences, important, summary, cards }, { recording: "Recording", summary: "Summary", cards: "Cards", noCards: "No cards", transcript: "Transcript", important: "important" });
  const totalMs = Object.values(t).reduce((a, b) => a + b, 0);
  const linked = cards.filter((c) => /#t=\d+/.test(JSON.stringify(c))).length;
  return { stages: t, totalMs, audioMinutes: Math.round((durationSec / 60) * 10) / 10, sentences: sentences.length, important: important.size, cards: cards.length, cardsLinked: linked, summary: { kind: summaryKind, sentences: summary.length }, noteChars: note.length };
}

export function verdict(r, net) {
  const pass = r.totalMs <= TARGET_MS && r.cardsLinked === r.cards && net.remote.length === 0;
  return { ...r, network: { local: net.local, remote: net.remote.length }, targetMs: TARGET_MS, pass };
}

if (process.argv[1]?.endsWith("student/lecture-timing.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const audio = opt("--audio");
  const cmd = process.env.LUMEN_ASR_CMD;
  const model = process.env.LUMEN_SUMMARY_MODEL;
  if (!audio || !existsSync(audio)) (console.error("--audio <recording> is required"), process.exit(2));
  if (!cmd || !model || spawnSync("ffmpeg", ["-version"]).error) (console.error("needs ffmpeg, LUMEN_ASR_CMD (whisper.cpp with -oj) and LUMEN_SUMMARY_MODEL (Ollama)"), process.exit(3));
  const { tsImport } = await import("tsx/esm/api");
  const core = await tsImport("../../src/student/lectureCore.ts", import.meta.url);
  const { checkedLectureSummarizer } = await tsImport("../../src/student/lectureSummarizer.ts", import.meta.url);
  const net = guardedFetch();
  globalThis.fetch = net.fetch;
  const work = mkdtempSync(join(tmpdir(), "lecture-"));
  const wav = join(work, "in.wav");
  const out = join(work, "asr");
  const run = checkedLectureSummarizer(ollamaSummary({ url: process.env.OLLAMA_URL || "http://127.0.0.1:11434", model, fetchImpl: net.fetch }), "Hebrew");
  const r = await timeLecture(
    {
      core,
      decode: () => {
        const d = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", audio, "-ar", "16000", "-ac", "1", wav]);
        if (d.status !== 0) throw new Error(`ffmpeg failed: ${d.stderr}`);
        return wav;
      },
      transcribe: (w) => {
        const c = spawnSync("sh", ["-c", cmd.replaceAll("{in}", quote(w)).replaceAll("{out}", quote(out))], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
        if (c.status !== 0) throw new Error(`the ASR command failed: ${c.stderr}`);
        return parseWhisperJson(readFileSync(`${out}.json`, "utf8"));
      },
      summarize: (s, i) => run(s, i),
    },
    { markers: (opt("--markers", "") || "").split(",").filter(Boolean).map(Number) },
  );
  const v = verdict(r, net.log);
  if (opt("--out")) writeFileSync(opt("--out"), JSON.stringify(v, null, 2) + "\n");
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.pass ? 0 : 1);
}
