/**
 * AI usage meter: tokens and an estimated cost per provider / model per
 * month, kept in localStorage on this device only.
 *
 * Providers report exact token counts where their API returns them
 * (`usage` / `usageMetadata`), including Anthropic prompt-cache reads and
 * writes; otherwise the LLM layer records a character-based estimate
 * (`estimated`). Answers served from the response cache are counted as
 * cache hits with no tokens.
 *
 * Prices are a static table (USD per million tokens, list prices as of
 * the date below). They are an estimate for the user, not a bill: the
 * provider's dashboard is authoritative.
 */

export const PRICES_AS_OF = "2026-10";

export interface Usage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Anthropic: input tokens read from the prompt cache (billed at ~10%). */
  cacheReadTokens?: number;
  /** Anthropic: input tokens written to the prompt cache (billed at ~125%). */
  cacheWriteTokens?: number;
  /** Counts were estimated from characters, not reported by the API. */
  estimated?: boolean;
  /** Server-side web searches (Claude web search: $10 per 1,000). */
  webSearches?: number;
}

/**
 * USD per 1M tokens: [input, output, cached input]. Matched by model-id
 * prefix, longest first. Cached input defaults to the provider's discount
 * (CACHE_READ_RATE) when not given.
 */
const PRICE_TABLE: Array<[prefix: string, input: number, output: number, cachedInput?: number]> = [
  // OpenAI (automatic prompt caching: 50% off for GPT-4o, 75% for 4.1 / o4)
  ["gpt-4o-mini", 0.15, 0.6, 0.075],
  ["gpt-4o", 2.5, 10, 1.25],
  ["gpt-4.1-nano", 0.1, 0.4, 0.025],
  ["gpt-4.1-mini", 0.4, 1.6, 0.1],
  ["gpt-4.1", 2, 8, 0.5],
  ["o4-mini", 1.1, 4.4, 0.275],
  ["ft:gpt-4o-mini", 0.3, 1.2, 0.15],
  // Anthropic (cache reads 10%, writes 125% of input)
  ["claude-3-5-haiku", 0.8, 4],
  ["claude-3-5-sonnet", 3, 15],
  ["claude-3-7-sonnet", 3, 15],
  ["claude-haiku-4", 1, 5],
  ["claude-sonnet-4", 3, 15],
  ["claude-opus-4-5", 5, 25],
  ["claude-opus-4", 15, 75],
  // Google (implicit caching: 75% off)
  ["gemini-1.5-flash", 0.075, 0.3],
  ["gemini-1.5-pro", 1.25, 5],
  ["gemini-2.0-flash", 0.1, 0.4],
  ["gemini-2.5-flash", 0.3, 2.5],
  ["gemini-2.5-pro", 1.25, 10],
  // Mistral (no prompt-cache discount)
  ["mistral-small", 0.2, 0.6],
  ["mistral-medium", 0.4, 2],
  ["mistral-large", 2, 6],
  ["codestral", 0.3, 0.9],
];
const SORTED = [...PRICE_TABLE].sort((a, b) => b[0].length - a[0].length);
/** Providers that run on the user's own hardware: no per-token cost. */
const FREE_PROVIDERS = new Set(["ollama", "local-webgpu"]);
/** Cached-input price as a share of the input price, per provider. */
const CACHE_READ_RATE: Record<string, number> = { anthropic: 0.1, openai: 0.5, gemini: 0.25 };
/** Cache-write price as a share of the input price (Anthropic only). */
const CACHE_WRITE_RATE: Record<string, number> = { anthropic: 1.25 };

export interface ModelPrice {
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite: number;
}

/** USD per 1M tokens for a model; all 0 for local providers; null when unknown. */
export function priceFor(provider: string, model: string): ModelPrice | null {
  if (FREE_PROVIDERS.has(provider)) return { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 };
  const m = model.toLowerCase();
  const hit = SORTED.find(([prefix]) => m.startsWith(prefix));
  if (!hit) return null;
  const [, input, output, cached] = hit;
  return {
    input,
    output,
    cachedInput: cached ?? input * (CACHE_READ_RATE[provider] ?? 1),
    cacheWrite: input * (CACHE_WRITE_RATE[provider] ?? 1),
  };
}

/** Estimated USD for one usage record, or null when the model's price is unknown. */
export function costOf(u: Usage): number | null {
  const p = priceFor(u.provider, u.model);
  if (!p) return null;
  const read = u.cacheReadTokens ?? 0;
  const write = u.cacheWriteTokens ?? 0;
  return (
    (u.inputTokens * p.input + read * p.cachedInput + write * p.cacheWrite + u.outputTokens * p.output) / 1_000_000 +
    ((u.webSearches ?? 0) * 10) / 1000
  );
}

/** Rough token count for text we have no API count for (~4 chars / token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface UsageBucket {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Requests answered from the local response cache (no API call). */
  cacheHits: number;
  /** Requests whose counts were estimated. */
  estimated: number;
  /** Sum of known costs (USD). */
  cost: number;
  /** Requests whose model has no known price. */
  unpriced: number;
}

type Store = Record<string /* YYYY-MM */, Record<string /* provider/model */, UsageBucket>>;

const KEY = "lumen.ai.usage.v1";
const KEEP_MONTHS = 12;
const listeners = new Set<() => void>();

export function monthOf(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  const months = Object.keys(store).sort();
  for (const m of months.slice(0, Math.max(0, months.length - KEEP_MONTHS))) delete store[m];
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked: the meter is best-effort */
  }
  for (const fn of listeners) fn();
}

const empty = (): UsageBucket => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheHits: 0,
  estimated: 0,
  cost: 0,
  unpriced: 0,
});

function bucket(store: Store, month: string, provider: string, model: string): UsageBucket {
  const m = (store[month] ??= {});
  return (m[`${provider}/${model}`] ??= empty());
}

/** Record one API request's usage. */
export function recordUsage(u: Usage, now: Date = new Date()): void {
  const store = load();
  const b = bucket(store, monthOf(now), u.provider, u.model || "default");
  b.requests++;
  b.inputTokens += Math.max(0, u.inputTokens | 0);
  b.outputTokens += Math.max(0, u.outputTokens | 0);
  b.cacheReadTokens += Math.max(0, (u.cacheReadTokens ?? 0) | 0);
  b.cacheWriteTokens += Math.max(0, (u.cacheWriteTokens ?? 0) | 0);
  if (u.estimated) b.estimated++;
  const c = costOf(u);
  if (c === null) b.unpriced++;
  else b.cost += c;
  save(store);
}

/** Record a request answered from the response cache (no tokens spent). */
export function recordCacheHit(provider: string, model: string, now: Date = new Date()): void {
  const store = load();
  bucket(store, monthOf(now), provider, model || "default").cacheHits++;
  save(store);
}

export interface UsageSummary {
  month: string;
  rows: Array<{ provider: string; model: string } & UsageBucket>;
  total: UsageBucket;
}

export function usageSummary(month: string = monthOf()): UsageSummary {
  const m = load()[month] ?? {};
  const total = empty();
  const rows = Object.entries(m)
    .map(([k, b]) => {
      const i = k.indexOf("/");
      return { provider: k.slice(0, i), model: k.slice(i + 1), ...empty(), ...b };
    })
    .sort((a, b) => b.cost - a.cost || b.requests - a.requests);
  for (const r of rows) {
    for (const f of Object.keys(total) as Array<keyof UsageBucket>) total[f] += r[f];
  }
  return { month, rows, total };
}

/** Plain-text report for the palette command. */
export function formatUsageReport(s: UsageSummary): string {
  const n = (x: number) => x.toLocaleString("en-US");
  const usd = (x: number) => (x < 0.01 && x > 0 ? "< $0.01" : `$${x.toFixed(2)}`);
  if (!s.rows.length) return `${s.month}: no AI requests on this device yet.`;
  const lines = [
    `${s.month} — ${n(s.total.requests)} requests, ${n(s.total.cacheHits)} answered from cache`,
    `Tokens: ${n(s.total.inputTokens)} in · ${n(s.total.outputTokens)} out` +
      (s.total.cacheReadTokens ? ` · ${n(s.total.cacheReadTokens)} prompt-cache reads` : "") +
      (s.total.cacheWriteTokens ? ` · ${n(s.total.cacheWriteTokens)} prompt-cache writes` : ""),
    `Estimated cost: ${usd(s.total.cost)}${s.total.unpriced ? ` (+ ${s.total.unpriced} requests with unknown prices)` : ""}`,
    "",
    ...s.rows.map(
      (r) =>
        `• ${r.provider} / ${r.model}: ${n(r.requests)} req · ${n(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)} in · ${n(r.outputTokens)} out · ${usd(r.cost)}` +
        (r.cacheHits ? ` · ${n(r.cacheHits)} cached` : "") +
        (r.estimated ? ` · ${r.estimated} estimated` : ""),
    ),
    "",
    `Prices: list prices as of ${PRICES_AS_OF}; your provider's dashboard is authoritative.`,
  ];
  return lines.join("\n");
}

export function onUsageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearUsage(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* */
  }
  for (const fn of listeners) fn();
}
