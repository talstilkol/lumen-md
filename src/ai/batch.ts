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

export function saveJobs(jobs: BatchJob[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(jobs.slice(-50)));
  } catch {
    /* */
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
  const items: BatchItem[] = notes.map((n, i) => ({ customId: `n${i}`, path: n.path }));
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
  saveJobs([...loadJobs(), job]);
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
  const meter = (model: string, usage: { input: number; output: number }) =>
    recordUsage({ provider: job.provider, model, inputTokens: usage.input, outputTokens: usage.output, batch: true });
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
  if (!b.output_file_id) return { state: "ended", answers, failed: job.items.length };
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
  return { state: "ended", answers, failed };
}

/* ─── Applying results ──────────────────────────────────────────────── */

const yamlString = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").trim());

/** Set (or replace) a top-level `key: value` line in the note's front matter, creating it when absent. */
export function setFrontmatterField(content: string, key: string, value: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const line = `${key}: ${value}`;
  if (!fm) return `---\n${line}\n---\n\n${content}`;
  const lines = fm[1].split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (at === -1) lines.push(line);
  else {
    // Drop an indented block value that belonged to the old field.
    let end = at + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
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
}

/**
 * The writes a finished job implies: tags / summary update the note's
 * front matter; translations become `<name>.<lang>.md` next to it.
 */
export function planWrites(
  job: BatchJob,
  answers: ReadonlyMap<string, string>,
  read: (path: string) => string | null,
  mergeTags: (content: string, tags: string[]) => string,
): PlannedWrite[] {
  const out: PlannedWrite[] = [];
  for (const item of job.items) {
    const answer = answers.get(item.customId);
    if (!answer) continue;
    if (job.op === "translate") {
      const code = (job.lang ?? "translated").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 20);
      out.push({ path: item.path.replace(/(\.(md|markdown))?$/i, `.${code}.md`), content: answer.trim() + "\n", created: true });
      continue;
    }
    const current = read(item.path);
    if (current === null) continue;
    if (job.op === "tags") {
      const tags = parseTags(answer);
      if (tags.length) out.push({ path: item.path, content: mergeTags(current, tags), created: false });
    } else {
      out.push({ path: item.path, content: setFrontmatterField(current, "summary", yamlString(answer)), created: false });
    }
  }
  return out;
}
