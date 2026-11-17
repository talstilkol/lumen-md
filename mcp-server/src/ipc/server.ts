/**
 * The socket `lumen` talks to (plan W13.K1): one JSON line in, one JSON
 * line out, per connection.
 *
 * A request must carry the token from the 0600 endpoint file; a wrong or
 * missing token closes the connection with an error and runs nothing.
 * Requests are capped at 1 MiB and must arrive within 10 s. The socket
 * file is made 0600. Nothing listens on TCP.
 */
import { promises as fs } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Host, Response } from "./host.js";
import { handle } from "./host.js";
import { checkSocketDir, newToken, tokenMatches, writeEndpointFile, ENDPOINT_FILE } from "./endpoint.js";
import { langOf, type Lang } from "./specs.js";

export const MAX_REQUEST = 1 << 20;
export const REQUEST_TIMEOUT_MS = 10_000;

export interface WireRequest {
  v: 1;
  token: string;
  cmd: string;
  args: string[];
  flags: Record<string, string>;
  yes?: boolean;
  lang?: Lang;
}

export function isWireRequest(v: unknown): v is WireRequest {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return r.v === 1 && typeof r.cmd === "string" && Array.isArray(r.args) && r.args.every((a) => typeof a === "string") && !!r.flags && typeof r.flags === "object" && Object.values(r.flags as object).every((x) => typeof x === "string");
}

export interface IpcServer {
  endpoint: string;
  token: string;
  close(): Promise<void>;
}

/** Remove a socket file left by a crashed app — only when nothing answers on it. */
async function clearStale(endpoint: string): Promise<void> {
  if (endpoint.startsWith("\\\\")) return;
  try {
    const st = await fs.lstat(endpoint);
    if (!st.isSocket()) throw new Error(`${endpoint} exists and is not a socket; not touching it.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const alive = await new Promise<boolean>((resolve) => {
    const s = net.connect(endpoint);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
  if (alive) throw new Error("Another Lumen is already listening for lumen commands.");
  await fs.rm(endpoint, { force: true });
}

export async function serveIpc(opts: { host: Host; configDir: string; endpoint: string; token?: string; now?: () => Date }): Promise<IpcServer> {
  const token = opts.token ?? newToken();
  await fs.mkdir(opts.configDir, { recursive: true, mode: 0o700 });
  if (!opts.endpoint.startsWith("\\\\")) {
    await fs.mkdir(path.dirname(opts.endpoint), { recursive: true, mode: 0o700 });
    await checkSocketDir(path.dirname(opts.endpoint));
  }
  await clearStale(opts.endpoint);
  const server = net.createServer((sock) => {
    let buf = "";
    let done = false;
    const reply = (r: Partial<Response> & { exit: number }) => {
      if (done) return;
      done = true;
      sock.end(JSON.stringify({ v: 1, data: null, lines: [], notes: [], via: "app", ...r }) + "\n");
    };
    sock.setEncoding("utf8");
    sock.setTimeout(REQUEST_TIMEOUT_MS, () => (reply({ exit: 1, notes: ["timed out"] }), sock.destroy()));
    sock.on("error", () => {});
    sock.on("data", (chunk: string) => {
      if (done) return;
      buf += chunk;
      if (buf.length > MAX_REQUEST) return reply({ exit: 1, notes: ["request too large"] });
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      let req: unknown;
      try {
        req = JSON.parse(buf.slice(0, nl));
      } catch {
        return reply({ exit: 1, notes: ["not JSON"] });
      }
      const token_ = (req as { token?: unknown })?.token;
      if (!tokenMatches(token, token_)) return reply({ exit: 77, notes: ["Lumen refused the request: wrong token. Is this your user's lumen?"] });
      if (!isWireRequest(req)) return reply({ exit: 2, notes: ["bad request"] });
      sock.setTimeout(0);
      const lang = req.lang === "he" || req.lang === "en" ? req.lang : langOf(undefined, {});
      handle(opts.host, { cmd: req.cmd, args: req.args, flags: req.flags, yes: req.yes === true }, { lang, now: opts.now?.() })
        .then((r) => reply({ ...r, via: "app" }))
        .catch((e) => reply({ exit: 1, notes: [String((e as Error)?.message ?? e)] }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.endpoint, () => (server.off("error", reject), resolve()));
  });
  if (!opts.endpoint.startsWith("\\\\")) await fs.chmod(opts.endpoint, 0o600).catch(() => {});
  await writeEndpointFile(opts.configDir, { v: 1, endpoint: opts.endpoint, token, pid: process.pid, vault: opts.host.port.root, startedAt: new Date().toISOString() });
  return {
    endpoint: opts.endpoint,
    token,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(path.join(opts.configDir, ENDPOINT_FILE), { force: true });
      if (!opts.endpoint.startsWith("\\\\")) await fs.rm(opts.endpoint, { force: true });
    },
  };
}
