/**
 * Deterministic, bounded retry wrapper for fetch requests with status-based
 * and network-error classification. Keeps transport logic explicit so each
 * external service has a consistent failure behavior.
 */

import { log } from "./logger";
import { recordRuntimeRequest } from "./runtimeMetrics";

export interface RetryFetchOptions {
  /** Human-readable operation name for logs. */
  label: string;
  /** Maximum retries after the first failed attempt. */
  maxRetries?: number;
  /** Base delay for exponential backoff (ms). */
  baseDelayMs?: number;
  /** Optional maximum delay cap (ms). */
  maxDelayMs?: number;
  /** Optional timeout per attempt (ms). */
  timeoutMs?: number;
  /** Optional metric category override. */
  metricCategory?:
    | "ai"
    | "semantic"
    | "semantic-index"
    | "publish"
    | "billing"
    | "sync"
    | "system"
    | "other";
}

interface TimeoutSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}

export function shouldRetryNetworkStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function shouldRetryError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return message.includes("network") || message.includes("failed to fetch") || message.includes("econn") || message.includes("timeout");
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: RetryFetchOptions,
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 700;
  const maxDelayMs = options.maxDelayMs ?? 4_000;
  const timeoutMs = options.timeoutMs ?? 0;
  const category = options.metricCategory;
  let attempt = 0;
  let lastResponse: Response | null = null;
  let lastError: unknown;
  let rateLimited = false;
  let timedOut = false;
  let retryableError = false;

  const start = performance.now();
  const baseSignal = init.signal ?? undefined;
  if (baseSignal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }

  while (attempt <= maxRetries) {
    // Use a single-element ref instead of a `let` so TS doesn't narrow
    // it to `null` for the lifetime of the closure (the callback
    // assigns into it, but flow analysis can't see across the
    // boundary).
    const timeoutSignalRef: { current: TimeoutSignal | null } = { current: null };
    try {
      const requestSignal = withRequestSignal(baseSignal, timeoutMs, (signal) => {
        timeoutSignalRef.current = signal;
      });
      const mergedInit: RequestInit = {
        ...init,
        ...(requestSignal ? { signal: requestSignal } : {}),
      };
      const response = await fetch(input, mergedInit);
      timeoutSignalRef.current?.cleanup();
      if (response.ok) {
        recordRuntimeRequest({
          label: options.label,
          category: options.metricCategory,
          success: true,
          durationMs: Math.max(0, performance.now() - start),
          timeout: false,
          rateLimit: false,
          retries: attempt,
        });
        return response;
      }
      lastResponse = response;
      if (response.status === 429) {
        rateLimited = true;
      }
      const statusText = `HTTP ${response.status}`;
      if (!shouldRetryNetworkStatus(response.status) || attempt >= maxRetries) {
        lastError = new Error(statusText);
        retryableError = false;
        break;
      }
      lastError = new Error(statusText);
      retryableError = true;
      log.warn(`[${options.label}] attempt ${attempt + 1}/${maxRetries + 1} after ${statusText}`);
      attempt += 1;
      if (attempt <= maxRetries) {
        await sleep(retryDelay(attempt - 1, baseDelayMs, maxDelayMs));
      }
      continue;
    } catch (err) {
      timeoutSignalRef.current?.cleanup();
      if (err instanceof DOMException && err.name === "AbortError" && baseSignal?.aborted) {
        throw err;
      }
      const isTimeoutError =
        err instanceof DOMException &&
        err.name === "TimeoutError";
      const isNetworkRetryable =
        isTimeoutError || shouldRetryError(err);
      if (isTimeoutError) {
        timedOut = true;
      }
      retryableError = isNetworkRetryable;
      if (err instanceof DOMException && err.name === "AbortError") {
        timedOut = false;
      }
      lastError = err;
      if (!retryableError || attempt >= maxRetries) {
        const details = getErrorMessage(err);
        lastError = new Error(details);
        break;
      }
      attempt += 1;
      if (attempt <= maxRetries) {
        if (lastError) {
          const details = lastError instanceof Error ? lastError.message : String(lastError);
          log.warn(`[${options.label}] retry ${attempt}/${maxRetries} after error: ${details}`);
        }
        await sleep(retryDelay(attempt - 1, baseDelayMs, maxDelayMs));
      }
    }
  }

  const totalMs = Math.max(0, performance.now() - start);
  recordRuntimeRequest({
    label: options.label,
    category,
    success: false,
    durationMs: totalMs,
    timeout: timedOut,
    rateLimit: rateLimited,
    retries: attempt,
    error: getErrorMessage(lastError),
  });
  if (lastResponse) {
    return lastResponse;
  }
  if (timedOut) {
    throw new Error(`[${options.label}] failed after ${attempt + 1} attempts: timeout`);
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[${options.label}] failed after ${attempt + 1} attempts: ${message}`);
}

function withRequestSignal(
  baseSignal: AbortSignal | undefined,
  timeoutMs: number,
  onCreated: (signal: TimeoutSignal) => void,
): AbortSignal | undefined {
  if (timeoutMs <= 0) {
    return baseSignal;
  }

  const timeoutController = new AbortController();
  const onBaseAbort = () => {
    timeoutController.abort(baseSignal?.reason);
  };
  const timeoutId = window.setTimeout(() => {
    timeoutController.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);

  if (baseSignal) {
    if (baseSignal.aborted) {
      window.clearTimeout(timeoutId);
      timeoutController.abort(baseSignal.reason);
      return timeoutController.signal;
    }
    baseSignal.addEventListener("abort", onBaseAbort, { once: true });
  }

  const signal = timeoutController.signal;
  const timeoutSignal: TimeoutSignal = {
    signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      if (baseSignal) {
        baseSignal.removeEventListener("abort", onBaseAbort);
      }
    },
  };
  onCreated(timeoutSignal);
  return signal;
}

function getErrorMessage(error: unknown): string {
  if (!error) return "unknown";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
