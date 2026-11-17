/**
 * Long-running MCP server tasks (plan W13.A2; spec 2026-07-28, the
 * `io.modelcontextprotocol/tasks` extension, SEP-2663), as the client sees
 * them: a tool call answered with `resultType: "task"` is polled with
 * `tasks/get` (at the server's `pollIntervalMs`), or followed through
 * `subscriptions/listen` when the transport can stream; input the task
 * needs on the way (`input_required`) is shown to the user like any
 * elicitation and answered with `tasks/update`; Cancel sends `tasks/cancel`.
 *
 * Every running task is listed in `serverTasks` (the batch jobs panel shows
 * them, with Cancel, plan 5.8), so a long transcription or import is never
 * a frozen tool call.
 */

export type TaskStatus = "working" | "input_required" | "completed" | "failed" | "cancelled";

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  statusMessage?: string;
  createdAt?: string;
  lastUpdatedAt?: string;
  ttlMs?: number | null;
  pollIntervalMs?: number;
  inputRequests?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

export const TERMINAL: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"]);
export const MIN_POLL_MS = 250;
export const MAX_POLL_MS = 60_000;
export const DEFAULT_POLL_MS = 2_000;

export function parseTask(r: Record<string, unknown>): TaskState {
  const status = r.status;
  if (typeof r.taskId !== "string" || !r.taskId || typeof status !== "string" || !["working", "input_required", "completed", "failed", "cancelled"].includes(status)) {
    throw new Error("not a task (taskId and a known status are required)");
  }
  return {
    taskId: r.taskId,
    status: status as TaskStatus,
    ...(typeof r.statusMessage === "string" ? { statusMessage: r.statusMessage.slice(0, 300) } : {}),
    ...(typeof r.createdAt === "string" ? { createdAt: r.createdAt } : {}),
    ...(typeof r.lastUpdatedAt === "string" ? { lastUpdatedAt: r.lastUpdatedAt } : {}),
    ...(typeof r.ttlMs === "number" || r.ttlMs === null ? { ttlMs: r.ttlMs as number | null } : {}),
    ...(typeof r.pollIntervalMs === "number" ? { pollIntervalMs: r.pollIntervalMs } : {}),
    ...(r.inputRequests && typeof r.inputRequests === "object" && !Array.isArray(r.inputRequests) ? { inputRequests: r.inputRequests as Record<string, unknown> } : {}),
    ...(r.result && typeof r.result === "object" ? { result: r.result as Record<string, unknown> } : {}),
    ...(r.error && typeof r.error === "object" ? { error: r.error as TaskState["error"] } : {}),
  };
}

/** The wait before the next poll: the server's interval, kept within reason. */
export function pollDelay(t: TaskState): number {
  const p = t.pollIntervalMs;
  return typeof p === "number" && Number.isFinite(p) ? Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, p)) : DEFAULT_POLL_MS;
}

/** Past `createdAt + ttlMs` and still not finished: the task is no longer usable (the spec's backstop). */
export function expired(t: TaskState, now: number, startedAt: number): boolean {
  if (typeof t.ttlMs !== "number") return false;
  const created = t.createdAt ? Date.parse(t.createdAt) : NaN;
  return now > (Number.isFinite(created) ? created : startedAt) + t.ttlMs;
}

export interface ServerTaskRow {
  id: string;
  server: string;
  tool: string;
  status: TaskStatus;
  statusMessage?: string;
  startedAt: number;
  cancel: () => void;
}

type Listener = () => void;

/** The running server tasks, for the batch jobs panel. */
class ServerTasks {
  private rows = new Map<string, ServerTaskRow>();
  private listeners = new Set<Listener>();
  list(): ServerTaskRow[] {
    return [...this.rows.values()].sort((a, b) => a.startedAt - b.startedAt);
  }
  upsert(row: ServerTaskRow): void {
    this.rows.set(row.id, row);
    this.emit();
  }
  remove(id: string): void {
    if (this.rows.delete(id)) this.emit();
  }
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

export const serverTasks = new ServerTasks();
