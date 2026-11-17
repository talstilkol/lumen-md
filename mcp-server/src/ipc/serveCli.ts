/**
 * `lumen host [--vault <dir>]` (plan W13.K1): serve the `lumen` commands
 * for a vault on disk over the per-user socket, as the app does, for a
 * machine without the desktop app (a server, a CI box). Changes still wait
 * in the vault's review queue (`lumen changes`, the app's review screen).
 */
import * as path from "node:path";
import { configDir, endpointFor } from "./endpoint.js";
import { diskHost } from "./host.js";
import { serveIpc } from "./server.js";
import { parseIpcArgs, type IpcIO } from "./client.js";

export async function runHost(argv: string[], io: IpcIO): Promise<number> {
  const { flags } = parseIpcArgs(argv);
  const vault = path.resolve(io.cwd, flags.vault || io.env.LUMEN_VAULT || ".");
  const e = { env: io.env };
  const dir = configDir(e);
  const srv = await serveIpc({ host: diskHost(vault, dir), configDir: dir, endpoint: endpointFor(e) });
  io.err(`lumen host: serving ${vault} on ${srv.endpoint} (Ctrl+C stops)`);
  const stop = () => void srv.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return -1;
}
