/**
 * Lightweight in-memory runtime metrics for network + AI + semantic paths.
 *
 * Purpose:
 * - track success/failure/retry at operation + category level
 * - flag timeout and rate-limit events
 * - expose p95 + average latency for operational visibility
 *
 * No persistence and no randomness by design — deterministic local telemetry.
 */

const MAX_DURATION_SAMPLES = 150;
const MAX_ERROR_MESSAGE_LEN = 260;

export type RuntimeMetricCategory =
  | "ai"
  | "semantic"
  | "semantic-index"
  | "publish"
  | "billing"
  | "sync"
  | "system"
  | "other";

interface MetricCore {
  total: number;
  success: number;
  timeout: number;
  rateLimit: number;
  retries: number;
  durationsMs: number[];
  lastError?: string;
  lastUpdatedAt: number;
}

interface MetricBucket extends MetricCore {
  label: string;
  category: RuntimeMetricCategory;
}

interface MetricInput {
  category?: RuntimeMetricCategory | "other";
  label: string;
  success: boolean;
  durationMs?: number;
  timeout?: boolean;
  rateLimit?: boolean;
  retries?: number;
  error?: string;
}

export interface RuntimeMetricSnapshot {
  lastUpdatedAt: number;
  categories: Record<string, RuntimeMetricSnapshotRow>;
  operations: Record<string, RuntimeMetricSnapshotRow>;
}

export interface RuntimeMetricSnapshotRow {
  label: string;
  category: RuntimeMetricCategory;
  total: number;
  successRate: number;
  timeoutRate: number;
  rateLimitRate: number;
  retryRatio: number;
  p95Ms: number;
  avgMs: number;
  lastError?: string;
  totalRetries: number;
  lastUpdatedAt: number;
}

const operationBuckets = new Map<string, MetricBucket>();
const categoryBuckets = new Map<RuntimeMetricCategory, MetricBucket>();

function normalizeCategory(category?: RuntimeMetricCategory | "other"): RuntimeMetricCategory {
  return category ?? "other";
}

function inferCategoryFromLabel(label: string): RuntimeMetricCategory {
  const normalized = label.toLowerCase();
  if (
    normalized.startsWith("llm.") ||
    normalized.startsWith("grammar.") ||
    normalized.startsWith("transcribe.") ||
    normalized.startsWith("finetune.") ||
    normalized.startsWith("ai.")
  ) return "ai";
  if (
    normalized === "semantic-index" ||
    normalized.startsWith("semantic-index.") ||
    normalized.startsWith("semanticindex")
  ) return "semantic-index";
  if (
    normalized.startsWith("semantic.") ||
    normalized.startsWith("rag.") ||
    normalized.includes("semantic") ||
    normalized.includes("embed") ||
    normalized.includes("embedding")
  ) return "semantic";
  if (normalized.startsWith("publish.") || normalized === "publish.note" || normalized === "publish.unpublish") return "publish";
  if (
    normalized.startsWith("billing.") ||
    normalized.includes("billing") ||
    normalized.includes("entitlement") ||
    normalized.includes("price") ||
    normalized.includes("stripe")
  ) return "billing";
  if (
    normalized.startsWith("entitlement.") ||
    normalized.startsWith("sync.") ||
    normalized === "listfiles" ||
    normalized === "readfile" ||
    normalized === "writefile" ||
    normalized.includes("cloud")
  ) return "sync";
  if (
    normalized.startsWith("checkout.") ||
    normalized.startsWith("portal.") ||
    normalized.startsWith("workos.") ||
    normalized.startsWith("templates.") ||
    normalized.includes("template") ||
    normalized.startsWith("registry") ||
    normalized.includes("registry") ||
    normalized.startsWith("audit") ||
    normalized.startsWith("publish.") ||
    normalized.startsWith("exporthtml") ||
    normalized.startsWith("export")
  ) return "system";
  return "other";
}

function clampText(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return undefined;
}

function getOperationBucket(category: RuntimeMetricCategory, label: string): MetricBucket {
  const key = `${category}::${label}`;
  let bucket = operationBuckets.get(key);
  if (!bucket) {
    bucket = {
      label,
      category,
      total: 0,
      success: 0,
      timeout: 0,
      rateLimit: 0,
      retries: 0,
      durationsMs: [],
      lastUpdatedAt: Date.now(),
    };
    operationBuckets.set(key, bucket);
  }
  return bucket;
}

function getCategoryBucket(category: RuntimeMetricCategory): MetricBucket {
  let bucket = categoryBuckets.get(category);
  if (!bucket) {
    bucket = {
      label: `${category}:all`,
      category,
      total: 0,
      success: 0,
      timeout: 0,
      rateLimit: 0,
      retries: 0,
      durationsMs: [],
      lastUpdatedAt: Date.now(),
    };
    categoryBuckets.set(category, bucket);
  }
  return bucket;
}

function addDuration(bucket: MetricBucket, durationMs?: number) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return;
  bucket.durationsMs.push(durationMs);
  if (bucket.durationsMs.length > MAX_DURATION_SAMPLES) bucket.durationsMs.shift();
}

function addToBucket(bucket: MetricBucket, params: MetricInput) {
  bucket.total += 1;
  if (params.success) bucket.success += 1;
  if (params.timeout) bucket.timeout += 1;
  if (params.rateLimit) bucket.rateLimit += 1;
  bucket.retries += params.retries ?? 0;
  if (!params.success && params.error) {
    const err = params.error.length > MAX_ERROR_MESSAGE_LEN ? `${params.error.slice(0, MAX_ERROR_MESSAGE_LEN)}…` : params.error;
    bucket.lastError = err;
  }
  addDuration(bucket, params.durationMs);
  bucket.lastUpdatedAt = Date.now();
}

function bucketToSnapshot(bucket: MetricBucket): RuntimeMetricSnapshotRow {
  const durationCount = bucket.durationsMs.length;
  const sum = durationCount === 0 ? 0 : bucket.durationsMs.reduce((a, b) => a + b, 0);
  const sorted = [...bucket.durationsMs].sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.floor((durationCount - 1) * 0.95));
  const p95Ms = durationCount === 0 ? 0 : sorted[p95Index] ?? 0;
  return {
    label: bucket.label,
    category: bucket.category,
    total: bucket.total,
    successRate: bucket.total === 0 ? 0 : (bucket.success / bucket.total) * 100,
    timeoutRate: bucket.total === 0 ? 0 : (bucket.timeout / bucket.total) * 100,
    rateLimitRate: bucket.total === 0 ? 0 : (bucket.rateLimit / bucket.total) * 100,
    retryRatio: bucket.total === 0 ? 0 : bucket.retries / bucket.total,
    p95Ms,
    avgMs: durationCount === 0 ? 0 : Math.round(sum / durationCount),
    lastError: bucket.lastError,
    totalRetries: bucket.retries,
    lastUpdatedAt: bucket.lastUpdatedAt,
  };
}

/**
 * Record a metric row.
 */
export function recordRuntimeRequest(params: MetricInput): void {
  const category = normalizeCategory(params.category ?? inferCategoryFromLabel(params.label));
  const opBucket = getOperationBucket(category, params.label);
  const catBucket = getCategoryBucket(category);
  const normalizedError = clampText(params.error);
  const error = normalizedError ?? undefined;

  addToBucket(opBucket, { ...params, category, error });
  addToBucket(catBucket, { ...params, category, label: `${category}:all`, error });
}

/**
 * Read the current snapshot.
 */
export function getRuntimeMetricsSnapshot(): RuntimeMetricSnapshot {
  const categories = Array.from(categoryBuckets.entries()).reduce<Record<string, RuntimeMetricSnapshotRow>>((acc, [category, bucket]) => {
    acc[category] = bucketToSnapshot(bucket);
    return acc;
  }, {});

  const operations = Array.from(operationBuckets.entries()).reduce<Record<string, RuntimeMetricSnapshotRow>>((acc, [key, bucket]) => {
    acc[key] = bucketToSnapshot(bucket);
    return acc;
  }, {});

  let lastUpdatedAt = Date.now();
  for (const bucket of categoryBuckets.values()) {
    if (bucket.lastUpdatedAt > lastUpdatedAt) lastUpdatedAt = bucket.lastUpdatedAt;
  }
  for (const bucket of operationBuckets.values()) {
    if (bucket.lastUpdatedAt > lastUpdatedAt) lastUpdatedAt = bucket.lastUpdatedAt;
  }

  return {
    lastUpdatedAt,
    categories,
    operations,
  };
}

export function clearRuntimeMetrics(): void {
  operationBuckets.clear();
  categoryBuckets.clear();
}
