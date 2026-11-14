/**
 * The MCP server over stdio (plans W2.3, W7.17). Kept apart from
 * `index.ts` (which connects at import time) so the CLI's `lumen mcp serve`
 * starts the same server.
 *
 * stdio framing: one JSON-RPC message per line on stdin and stdout
 * (spec: Transports, stdio). The protocol itself — both 2026-07-28 and the
 * legacy `initialize` era — is in protocol.ts. stdout carries only
 * protocol messages; every log line goes to stderr.
 */
import { createInterface } from "node:readline";
import { normalizeClientId } from "./vault/config.js";
import { ERR, McpEndpoint, SERVER_VERSION, type JsonRpcResponse, type NotifySink } from "./protocol.js";

export { SERVER_VERSION };

/**
 * The client a call is attributed to: `--client <id>` / `LUMEN_MCP_CLIENT`
 * when the user's config names one (recommended — a client cannot pick it
 * itself), else the name the client reports.
 */
export function clientIdFor(explicit: string | undefined, reported: string | undefined): string {
  return normalizeClientId(explicit || reported || "unknown");
}

/** Parse one stdin line; a line that is not JSON gets a parse error. */
export async function handleLine(endpoint: McpEndpoint, line: string, sink?: NotifySink): Promise<JsonRpcResponse | null> {
  if (!line.trim()) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return { jsonrpc: "2.0", id: null, error: { code: ERR.parse, message: "Parse error." } };
  }
  return endpoint.handle(msg, sink);
}

export async function serveStdio(vault: string, explicitClient?: string): Promise<void> {
  const log = (l: string) => process.stderr.write(l.endsWith("\n") ? l : `${l}\n`);
  const endpoint = new McpEndpoint({ vault, explicitClient, log });
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  log(`lumen-mcp ${SERVER_VERSION}: vault ${vault}; MCP 2026-07-28 and 2025-11-25; tools per .lumen/mcp.json (off until enabled)`);
  const inflight = new Set<Promise<void>>();
  // subscriptions/listen (W11.I8): its messages share stdout, tagged with the subscription id.
  const sink = { notify: (m: unknown) => void process.stdout.write(JSON.stringify(m) + "\n") };
  const poll = setInterval(() => void endpoint.pollChanges(), 1000);
  (poll as { unref?: () => void }).unref?.();
  rl.on("line", (line) => {
    // Requests are independent (stateless): answer each as soon as it is done.
    const p = handleLine(endpoint, line, sink).then((res) => {
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    });
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  });
  await new Promise<void>((resolve) => rl.once("close", () => resolve()));
  await Promise.allSettled([...inflight]);
  clearInterval(poll);
  endpoint.closeSubscriptions();
}
