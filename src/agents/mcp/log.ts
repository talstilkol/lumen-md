/**
 * Each MCP server's log (plan W7.18, W10.C1): the stderr lines of a stdio
 * server (the 2026-07-28 spec moved server logging to stderr), plus starts,
 * stops and refusals. In memory, bounded per server; Settings → MCP servers
 * shows it. Starts and stops of a stdio server are also in the privacy
 * ledger, under `stdio://<server>` (registry.ts).
 */

export interface LogLine {
  ts: number;
  stream: "stderr" | "lumen";
  text: string;
}

export const MAX_LOG_LINES = 300;
const MAX_TEXT = 2000;

const logs = new Map<string, LogLine[]>();
const listeners = new Set<() => void>();

export function appendServerLog(serverId: string, stream: LogLine["stream"], text: string, ts: number = Date.now()): void {
  const list = [...(logs.get(serverId) ?? []), { ts, stream, text: text.slice(0, MAX_TEXT) }].slice(-MAX_LOG_LINES);
  logs.set(serverId, list);
  for (const fn of [...listeners]) fn();
}

export function serverLog(serverId: string): readonly LogLine[] {
  return logs.get(serverId) ?? [];
}

export function subscribeServerLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests. */
export function clearServerLogs(): void {
  logs.clear();
}
