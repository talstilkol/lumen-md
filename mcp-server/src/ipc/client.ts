/**
 * `lumen <command>` (plan W13.K1): ask the running app over its socket;
 * when it is not running, answer read commands from the disk, and for a
 * write either start the app and wait for it, or (with `--offline`) queue
 * the change in the vault for review.
 *
 *   lumen <command> [args…] [--json] [--vault <dir>] [--lang he|en] [--yes] [--offline]
 *
 * Exit codes: 0 ok, 1 error, 2 usage (or refused), 3 nothing found,
 * 4 the app is needed and not running, 5 conflict, 77 wrong token.
 */
import * as net from "node:net";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { configDir, readEndpointFile, type EndpointFile } from "./endpoint.js";
import { diskHost, handle, type Response } from "./host.js";
import type { WireRequest } from "./server.js";
import { langOf, REFUSED, SPEC_BY_NAME, SPECS } from "./specs.js";
import { applyChangeSet, getChangeSet } from "./changeset.js";
import { lineDiff } from "../vault/pending.js";

/** `approve` is answered here only: a person at a terminal, never over the socket. */
export const IPC_COMMANDS: readonly string[] = [...SPECS.map((s) => s.name), "approve", ...Object.keys(REFUSED)];

const BOOL = new Set(["json", "yes", "offline", "list", "open", "done"]);

export function parseIpcArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m) positional.push(a);
    else if (m[2] !== undefined) flags[m[1]] = m[2];
    else if (BOOL.has(m[1])) flags[m[1]] = "1";
    else flags[m[1]] = argv[++i] ?? "";
  }
  return { positional, flags };
}

/** One request to the app; null when nothing answers (not running, stale file). */
export function callApp(ep: EndpointFile, req: Omit<WireRequest, "token" | "v">, timeoutMs = 30_000): Promise<Response | null> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(ep.endpoint);
    let buf = "";
    let connected = false;
    const timer = setTimeout(() => (sock.destroy(), reject(new Error("Lumen did not answer in time."))), timeoutMs);
    sock.setEncoding("utf8");
    sock.once("connect", () => {
      connected = true;
      sock.write(JSON.stringify({ v: 1, token: ep.token, ...req }) + "\n");
    });
    sock.on("data", (c: string) => (buf += c));
    sock.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buf.trim()) as Response);
      } catch {
        reject(new Error("Lumen sent an answer that is not JSON."));
      }
    });
    sock.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (!connected && ["ENOENT", "ECONNREFUSED", "ENOTSOCK", "EPIPE"].includes(e.code ?? "")) resolve(null);
      else reject(e);
    });
  });
}

export interface IpcIO {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  cwd: string;
  now?: () => Date;
  /** Start the app (tests pass a fake). */
  launch?: () => void;
  /** How long to wait for a started app (ms). */
  launchWaitMs?: number;
  /** `lumen approve`: both ends a terminal, and a way to ask (as in `lumen mcp approve`, review 21 B1). */
  tty?: boolean;
  ask?: (question: string) => Promise<string>;
}

/**
 * `lumen approve <id>`: show the whole change, then write it only after a
 * typed "yes" at a terminal. The app's review screen is the approval to
 * rely on; this is for a vault without the app (review 24: a terminal is
 * not proof of a person).
 */
async function approveHere(vault: string, id: string | undefined, io: IpcIO, lang: "en" | "he"): Promise<number> {
  const cs = id ? await getChangeSet(vault, id) : null;
  if (!cs) {
    io.err(lang === "he" ? `אין שינוי ממתין ${id ?? ""}.` : `No waiting change ${id ?? ""}.`);
    return 3;
  }
  io.out(`${cs.id}: ${cs.summary}`);
  for (const o of cs.ops) {
    if (o.op === "move") io.out(`→ ${o.from} ⇒ ${o.to}`);
    else if (o.op === "delete") io.out(`✕ ${o.path}`);
    else {
      io.out(`~ ${o.path}`);
      for (const l of lineDiff(o.before, o.after, 400)) io.out(`  ${l}`);
    }
  }
  if (!io.tty || !io.ask) {
    io.err(lang === "he" ? "אישור דורש מסוף (TTY). שום דבר לא נכתב. אפשר לאשר במסך האישורים של Lumen." : "Approving needs a terminal (a TTY). Nothing was written. You can approve in Lumen's review screen.");
    return 2;
  }
  if ((await io.ask(lang === "he" ? 'הקלידו "yes" כדי לכתוב את השינוי: ' : 'Type "yes" to write this change: ')).trim().toLowerCase() !== "yes") {
    io.err(lang === "he" ? "לא נכתב." : "Not written.");
    return 1;
  }
  const r = await applyChangeSet(vault, cs, "cli tty");
  if (r.status === "conflict") {
    io.err(`${r.path}: ${r.reason}`);
    return 5;
  }
  io.out(lang === "he" ? `נכתב: ${r.paths.length} קבצים.` : `Written: ${r.paths.length} file(s).`);
  return 0;
}

function defaultLaunch(): void {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", ["-b", "app.lumen.editor"]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", "lumen://open"]] : ["xdg-open", ["lumen://open"]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runIpcCli(argv: string[], io: IpcIO): Promise<number> {
  const { positional, flags } = parseIpcArgs(argv);
  const [cmd, ...args] = positional;
  const lang = langOf(flags.lang, io.env);
  const print = (r: Response) => {
    if (flags.json) io.out(JSON.stringify(r));
    else {
      for (const l of r.lines) io.out(l);
      for (const n of r.notes) io.err(n);
    }
    return r.exit;
  };
  const cfg = configDir({ env: io.env });
  const spec = SPEC_BY_NAME.get(cmd ?? "");
  const vault = path.resolve(io.cwd, flags.vault || io.env.LUMEN_VAULT || ".");
  const req = { cmd: cmd ?? "help", args: cmd ? args : [], flags, yes: !!flags.yes, lang };
  if (cmd === "approve") return approveHere(vault, args[0], io, lang);
  const local = () => handle(diskHost(vault, cfg), req, { lang, now: io.now?.() }).then(print);
  if (!spec) return local(); // unknown, refused (eval) and bare `lumen`: answered here
  if (cmd === "help" || cmd === "version") return local();

  const ask = async (): Promise<Response | null> => {
    const ep = await readEndpointFile(cfg);
    if (!ep) return null;
    // The app has another vault open: this one is on disk.
    if ((flags.vault || io.env.LUMEN_VAULT) && ep.vault && path.resolve(ep.vault) !== vault) return null;
    return callApp(ep, req);
  };
  try {
    const r = await ask();
    if (r) return print(r);
  } catch (e) {
    io.err(`error: ${(e as Error).message}`);
    return 1;
  }
  if (spec.kind !== "write" || flags.offline) return local();
  // A write needs the app's review screen: start it and wait.
  (io.launch ?? defaultLaunch)();
  const until = Date.now() + (io.launchWaitMs ?? 15_000);
  while (Date.now() < until) {
    await sleep(250);
    try {
      const r = await ask();
      if (r) return print(r);
    } catch {
      /* still starting */
    }
  }
  io.err(lang === "he" ? "‏Lumen לא פועל, ולכן לא הוצע שום שינוי. פתחו את Lumen, או הוסיפו ‎--offline כדי להשאיר את השינוי בכספת לאישור." : "Lumen is not running, so nothing was proposed. Open Lumen, or add --offline to leave the change in the vault for review.");
  return 4;
}
