/**
 * Batch AI over a folder (Plan D: D9): tag, summarise or translate many
 * notes through the providers' batch APIs — Anthropic Message Batches or
 * the OpenAI Batch API — which bill at half price and answer within 24 h.
 *
 * A job is submitted once, remembered in localStorage, polled with "AI:
 * Check Batch Jobs", and its results are applied to the notes when they
 * arrive (never to a note that is open in a tab, and only after the user
 * confirms).
 */
import { getActiveProvider, getProviderKey, effectiveModel, AiError, type AiProvider } from "./llm";
import { PROMPTS } from "./prompts";
import { recordUsage } from "./usage";

export type BatchOp = "tags" | "summary" | "translate";
export type BatchProvider = "anthropic" | "openai";

export interface BatchItem {
  customId: string;
  path: string;
  /** Fingerprint of the text that was sent: results for a note edited since are skipped. */
  hash?: string;
}

/** Short, stable fingerprint of a note's text (FNV-1a 32-bit, hex). */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const TRANSLATIONS = "lumen.ai.batch.translations";
/**
 * Paths of translation files older batches recorded (before translations
 * carried a `translatedFrom` marker; see isBatchTranslation). Read-only.
 */
export function knownTranslations(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(TRANSLATIONS) ?? "[]");
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}
/** Front matter keys a batch translation carries: its source note and its job. */
export const TRANSLATED_FROM = "translatedFrom";
export const TRANSLATION_JOB = "translationJob";

/** True for a note a translation batch generated (so later batches skip it). */
export function isBatchTranslation(content: string): boolean {
  return frontmatterField(content, TRANSLATED_FROM) !== null;
}

export interface BatchJob {
  id: string;
  provider: BatchProvider;
  model: string;
  op: BatchOp;
  /** Target language (translate). */
  lang?: string;
  createdAt: string;
  items: BatchItem[];
  status: "submitted" | "ended" | "applied" | "failed" | "expired" | "cancelled";
  /** Usage already recorded (results are re-downloaded until applied). */
  metered?: boolean;
  /** Notes (sources) whose result has already been written — skipped on a retry. */
  done?: string[];
}

const STORE = "lumen.ai.batches";
/** Characters of each note sent (long notes are cut, with a marker). */
export const MAX_NOTE_CHARS = 24_000;

export function batchProviderFor(provider: AiProvider): BatchProvider | null {
  return provider === "anthropic" || provider === "openai" ? provider : null;
}

export function loadJobs(): BatchJob[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Persist the job list; false when storage is full or blocked. */
export function saveJobs(jobs: BatchJob[]): boolean {
  try {
    // Unfinished jobs are always kept; only finished history is trimmed.
    const finished = jobs.filter((j) => j.status === "applied" || j.status === "failed" || j.status === "expired" || j.status === "cancelled");
    const keep = new Set([...jobs.filter((j) => !finished.includes(j)), ...finished.slice(-50)]);
    localStorage.setItem(STORE, JSON.stringify(jobs.filter((j) => keep.has(j))));
    return true;
  } catch {
    return false;
  }
}

const TAG_SYSTEM =
  "Suggest 3-7 concise lowercase-kebab-case tags that capture this Markdown note's topic. " +
  'Output ONLY a JSON array of strings, e.g. ["machine-learning","paper-summary"].';
const SUMMARY_SYSTEM = "Summarise this Markdown note in one or two plain sentences (no Markdown, no preamble). Use the note's language.";

/** System prompt and user message for one note. */
export function requestFor(op: BatchOp, text: string, lang?: string): { system: string; user: string; maxTokens: number } {
  const body = text.length > MAX_NOTE_CHARS ? text.slice(0, MAX_NOTE_CHARS) + "\n…" : text;
  if (op === "tags") return { system: TAG_SYSTEM, user: body, maxTokens: 100 };
  if (op === "summary") return { system: SUMMARY_SYSTEM, user: body, maxTokens: 200 };
  return { system: PROMPTS.translate, user: `Target language: ${lang ?? "English"}\n\n---\n\n${body}`, maxTokens: Math.min(16_000, Math.ceil(body.length / 2) + 500) };
}

type Fetch = typeof fetch;

/* ─── Anthropic Message Batches ─────────────────────────────────────── */

const ANTHROPIC = "https://api.anthropic.com/v1/messages/batches";
const anthropicHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": getProviderKey("anthropic"),
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});

/* ─── OpenAI Batch API ──────────────────────────────────────────────── */

const OPENAI = "https://api.openai.com/v1";

/** Submit a job for `notes`; returns the stored job. */
export async function submitBatch(
  op: BatchOp,
  notes: ReadonlyArray<{ path: string; text: string }>,
  opts: { lang?: string; fetchImpl?: Fetch } = {},
): Promise<BatchJob> {
  const f = opts.fetchImpl ?? fetch;
  const provider = batchProviderFor(getActiveProvider());
  if (!provider) throw new AiError("API_ERROR", "Batch jobs need the OpenAI or Anthropic provider (AI: Switch Provider).");
  const model = effectiveModel(provider);
  const items: BatchItem[] = notes.map((n, i) => ({ customId: `n${i}`, path: n.path, hash: textHash(n.text) }));
  let id: string;
  if (provider === "anthropic") {
    const requests = notes.map((n, i) => {
      const r = requestFor(op, n.text, opts.lang);
      return { custom_id: items[i].customId, params: { model, max_tokens: r.maxTokens, system: r.system, messages: [{ role: "user", content: r.user }] } };
    });
    const res = await f(ANTHROPIC, { method: "POST", headers: anthropicHeaders(), body: JSON.stringify({ requests }) });
    if (!res.ok) throw new AiError("API_ERROR", `Anthropic batch ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    id = (await res.json()).id;
  } else {
    const key = getProviderKey("openai");
    const jsonl = notes
      .map((n, i) => {
        const r = requestFor(op, n.text, opts.lang);
        return JSON.stringify({
          custom_id: items[i].customId,
          method: "POST",
          url: "/v1/chat/completions",
          body: { model, max_tokens: r.maxTokens, messages: [{ role: "system", content: r.system }, { role: "user", content: r.user }] },
        });
      })
      .join("\n");
    const form = new FormData();
    form.append("purpose", "batch");
    form.append("file", new Blob([jsonl], { type: "application/jsonl" }), "lumen-batch.jsonl");
    const up = await f(`${OPENAI}/files`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!up.ok) throw new AiError("API_ERROR", `OpenAI file upload ${up.status}`);
    const fileId = (await up.json()).id;
    const res = await f(`${OPENAI}/batches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input_file_id: fileId, endpoint: "/v1/chat/completions", completion_window: "24h" }),
    });
    if (!res.ok) throw new AiError("API_ERROR", `OpenAI batch ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    id = (await res.json()).id;
  }
  const job: BatchJob = { id, provider, model, op, lang: opts.lang, createdAt: new Date().toISOString(), items, status: "submitted" };
  if (!saveJobs([...loadJobs(), job])) {
    // The provider already has the job: give its ID so the results stay reachable.
    throw new AiError(
      "API_ERROR",
      `Batch ${id} was submitted to ${provider}, but this device couldn't save it (storage full or blocked), so "Check Batch Jobs" won't list it. Its results are in your ${provider} console under that ID.`,
    );
  }
  return job;
}

export interface BatchResults {
  /** "processing" while the provider is still working. */
  state: "processing" | "ended" | "failed" | "expired" | "cancelled";
  /** customId → answer text (succeeded requests only). */
  answers: Map<string, string>;
  failed: number;
}

/** Poll a job; when it has ended, download its results and meter them (batch price). */
export async function fetchBatchResults(job: BatchJob, fetchImpl: Fetch = fetch): Promise<BatchResults> {
  const answers = new Map<string, string>();
  let failed = 0;
  // Results may be fetched again (user declined to apply): meter once.
  const alreadyMetered = !!job.metered;
  const meter = (model: string, usage: { input: number; output: number }) => {
    if (!alreadyMetered) recordUsage({ provider: job.provider, model, inputTokens: usage.input, outputTokens: usage.output, batch: true });
    job.metered = true;
  };
  if (job.provider === "anthropic") {
    const res = await fetchImpl(`${ANTHROPIC}/${job.id}`, { headers: anthropicHeaders() });
    if (!res.ok) throw new AiError("API_ERROR", `Anthropic batch ${res.status}`);
    const b = await res.json();
    if (b.processing_status !== "ended") return { state: "processing", answers, failed };
    const out = await fetchImpl(b.results_url, { headers: anthropicHeaders() });
    if (!out.ok) throw new AiError("API_ERROR", `Anthropic batch results ${out.status}`);
    for (const line of (await out.text()).split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.result?.type === "succeeded") {
        const m = r.result.message;
        const text = (m.content ?? []).filter((c: { type?: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("").trim();
        if (text) answers.set(r.custom_id, text);
        if (m.usage) meter(m.model ?? job.model, { input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0 });
      } else failed++;
    }
    return { state: "ended", answers, failed };
  }
  const key = getProviderKey("openai");
  const res = await fetchImpl(`${OPENAI}/batches/${job.id}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new AiError("API_ERROR", `OpenAI batch ${res.status}`);
  const b = await res.json();
  if (b.status === "failed" || b.status === "expired" || b.status === "cancelled") return { state: b.status, answers, failed: job.items.length };
  if (b.status !== "completed") return { state: "processing", answers, failed };
  // Failed requests go to error_file_id; request_counts has the total.
  const reportedFailed = Number(b.request_counts?.failed ?? 0);
  if (!b.output_file_id) return { state: "ended", answers, failed: Math.max(reportedFailed, job.items.length) };
  {
    const out = await fetchImpl(`${OPENAI}/files/${b.output_file_id}/content`, { headers: { Authorization: `Bearer ${key}` } });
    if (!out.ok) throw new AiError("API_ERROR", `OpenAI batch results ${out.status}`);
    for (const line of (await out.text()).split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      const body = r.response?.body;
      const text = body?.choices?.[0]?.message?.content?.trim();
      if (r.response?.status_code === 200 && text) {
        answers.set(r.custom_id, text);
        if (body.usage) meter(body.model ?? job.model, { input: body.usage.prompt_tokens ?? 0, output: body.usage.completion_tokens ?? 0 });
      } else failed++;
    }
  }
  return { state: "ended", answers, failed: Math.max(failed + reportedFailed, job.items.length - answers.size) };
}

/* ─── Applying results ──────────────────────────────────────────────── */

const yamlString = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").trim());

/** Set (or replace) a top-level `key: value` line in the note's front matter, creating it when absent. */
/** True when every `[` / `{` opened in a YAML flow value is closed (quotes respected). */
function flowClosed(text: string, open: string): boolean {
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let quote: string | null = null;
  for (const ch of text.slice(text.indexOf(open))) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return true;
  }
  return false;
}

export function setFrontmatterField(content: string, key: string, value: string): string {
  // `---\n---` (empty front matter) counts too.
  const fm = /^---\r?\n(?:([\s\S]*?)\r?\n)?---/.exec(content);
  const line = `${key}: ${value}`;
  if (!fm) return `---\n${line}\n---\n\n${content}`;
  const lines = fm[1] ? fm[1].split(/\r?\n/) : [];
  const at = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (at === -1) lines.push(line);
  else {
    // Drop the old value's continuation: indented lines, and blank lines
    // inside a block scalar / list, up to the next top-level key.
    let end = at + 1;
    while (end < lines.length && (/^\s+\S/.test(lines[end]) || (!lines[end].trim() && lines.slice(end + 1).some((l) => l.trim()) && /^\s+\S/.test(lines.slice(end + 1).find((l) => l.trim()) ?? "")))) end++;
    // A multi-line flow collection (`key: [` … `]`) ends at its closing
    // bracket, which may sit at column 0.
    const flow = /^[^:]+:\s*([[{])/.exec(lines[at]);
    if (flow && !flowClosed(lines.slice(at, end).join("\n"), flow[1])) {
      while (end < lines.length && !flowClosed(lines.slice(at, end + 1).join("\n"), flow[1])) end++;
      end = Math.min(lines.length, end + 1);
    }
    lines.splice(at, end - at, line);
  }
  return `---\n${lines.join("\n")}\n---` + content.slice(fm[0].length);
}

/** Tags from a model answer (JSON array, or comma-separated). */
export function parseTags(answer: string): string[] {
  const cleaned = answer.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = cleaned.split(/[,\n]+/);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((t) => String(t).trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9-]/g, "-"))
    .filter((t) => t.length > 1 && t.length < 40)
    .slice(0, 7);
}

export interface PlannedWrite {
  path: string;
  content: string;
  /** A new file (translation) rather than an update. */
  created: boolean;
  /** The note the result came from. */
  source: string;
}

/** A YAML line without its trailing `# comment` (a `#` after whitespace, outside quoted scalars). */
export function stripYamlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === "\\") i++;
      else if (quote === "'" && ch === "'" && line[i + 1] === "'") i++; // '' is an escaped quote
      else if (ch === quote) quote = null;
    } else if ((ch === '"' || ch === "'") && (i === 0 || /[\s:[{,-]/.test(line[i - 1]))) quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line;
}

/** A plain or quoted YAML scalar's value (`'it''s'` → `it's`, `"a\"b"` → `a"b`). */
function yamlScalar(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** A top-level scalar field of the front matter, or null when absent. */
export function frontmatterField(content: string, key: string): string | null {
  const fm = /^---\r?\n(?:([\s\S]*?)\r?\n)?---/.exec(content)?.[1];
  if (!fm) return null;
  const line = fm.split(/\r?\n/).find((l) => l.startsWith(key) && new RegExp(`^${key}\\s*:`).test(l));
  return line === undefined ? null : yamlScalar(stripYamlComment(line.replace(/^[^:]+:/, "")));
}

/** Existing tags in the front matter: inline `[a, b]`, `a, b`, or a block list. */
export function frontmatterTags(content: string): string[] {
  const fm = /^---\r?\n(?:([\s\S]*?)\r?\n)?---/.exec(content)?.[1];
  if (!fm) return [];
  // Comments (`tags: [a, b] # note`) aren't part of the value.
  const lines = fm.split(/\r?\n/).map(stripYamlComment);
  const at = lines.findIndex((l) => /^tags\s*:/.test(l));
  if (at === -1) return [];
  let inline = lines[at].replace(/^tags\s*:\s*/, "").trim();
  // A flow list over several lines: `tags: [` … `]`.
  if (inline.startsWith("[")) {
    let end = at;
    while (end + 1 < lines.length && !flowClosed(lines.slice(at, end + 1).join("\n"), "[")) end++;
    inline = lines.slice(at, end + 1).join(" ").replace(/^tags\s*:\s*/, "").replace(/,\s*\]\s*$/, "]").trim();
  }
  if (inline) {
    // Split on commas outside quotes: ["a, b", c] is two tags.
    const body = inline.replace(/^\[|\]$/g, "");
    const out: string[] = [];
    for (const m of body.matchAll(/\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+)\s*(?:,|$)/g)) {
      const t = yamlScalar(m[1]);
      if (t) out.push(t);
    }
    return out;
  }
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && /^\s+-\s*/.test(lines[i]); i++) out.push(yamlScalar(lines[i].replace(/^\s+-\s*/, "")));
  return out.filter(Boolean);
}

/** Existing tags plus new ones (no duplicates), written as one inline array. */
export function mergeTags(content: string, tags: readonly string[]): string {
  const all = [...new Set([...frontmatterTags(content), ...tags])];
  // Plain tags stay bare; anything YAML could misread (spaces, `:`, `#`,
  // brackets, quotes…) is quoted.
  const yaml = (t: string) => (/^[\p{L}\p{N}_./-]+$/u.test(t) && !/^[-.]/.test(t) ? t : JSON.stringify(t));
  return setFrontmatterField(content, "tags", `[${all.map(yaml).join(", ")}]`);
}

/**
 * The writes a finished job implies: tags / summary update the note's
 * front matter; translations become `<name>.<lang>.md` next to it.
 */
export function planWrites(
  job: BatchJob,
  answers: ReadonlyMap<string, string>,
  read: (path: string) => string | null,
  exists: (path: string) => boolean = (p) => read(p) !== null,
  /** Notes edited since submission are collected here (their results are skipped). */
  changed: string[] = [],
): PlannedWrite[] {
  const out: PlannedWrite[] = [];
  const taken = new Set<string>();
  /** `base.md`, else `base-2.md`, `base-3.md`… — never an existing or planned file. */
  const freePath = (want: string) => {
    let p = want;
    for (let n = 2; exists(p) || taken.has(p.toLowerCase()); n++) p = want.replace(/\.md$/i, `-${n}.md`);
    taken.add(p.toLowerCase());
    return p;
  };
  for (const item of job.items) {
    const answer = answers.get(item.customId);
    if (!answer || job.done?.includes(item.path)) continue;
    const current = read(item.path);
    if (current === null) continue;
    // The answer is about the text that was sent: skip notes edited since.
    if (item.hash && textHash(current) !== item.hash) {
      changed.push(item.path);
      continue;
    }
    if (job.op === "translate") {
      const code = (job.lang ?? "translated").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 20);
      const want = item.path.replace(/(\.(md|markdown))?$/i, `.${code}.md`);
      // A retry of this job (its state couldn't be saved) finds the file it
      // already wrote by its markers instead of writing a `-2` copy.
      if (writtenByJob(want, item.path, job.id, read, exists)) continue;
      // The markers make later batches skip this note, however many there are.
      let content = setFrontmatterField(answer.trim() + "\n", TRANSLATED_FROM, yamlString(item.path));
      content = setFrontmatterField(content, TRANSLATION_JOB, yamlString(job.id));
      out.push({ path: freePath(want), content, created: true, source: item.path });
      continue;
    }
    if (job.op === "tags") {
      const tags = parseTags(answer);
      if (tags.length) out.push({ path: item.path, content: mergeTags(current, tags), created: false, source: item.path });
    } else {
      out.push({ path: item.path, content: setFrontmatterField(current, "summary", yamlString(answer)), created: false, source: item.path });
    }
  }
  return out;
}

/** Whether `want` (or one of its `-2`, `-3`… siblings) is the translation job `id` made of `source`. */
function writtenByJob(want: string, source: string, id: string, read: (path: string) => string | null, exists: (path: string) => boolean): boolean {
  for (let n = 2, p = want; exists(p); p = want.replace(/\.md$/i, `-${n++}.md`)) {
    const text = read(p);
    if (text !== null && frontmatterField(text, TRANSLATED_FROM) === source && frontmatterField(text, TRANSLATION_JOB) === id) return true;
  }
  return false;
}
