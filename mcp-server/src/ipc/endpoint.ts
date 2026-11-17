/**
 * Where the running app listens for `lumen` (plan W13.K1), and the secret
 * that proves a caller is this user.
 *
 * - The endpoint is a Unix domain socket in the user's runtime folder
 *   (macOS, Linux), or a named pipe on Windows. Never a TCP port: nothing
 *   is reachable from the network, and no new network path appears in the
 *   privacy ledger.
 * - The app writes `cli-ipc.json` (endpoint and a 256-bit token) into its
 *   per-user config folder with mode 0600, inside a 0700 folder. Another
 *   user cannot read it, so cannot connect; a process of this user that can
 *   read the user's files could anyway.
 * - Every request carries the token; the host compares in constant time
 *   and closes the connection on a mismatch.
 * - `cli-settings.json` next to it holds the user's choices for the CLI
 *   (`allowYes`). The CLI only reads it: the app's settings write it, so an
 *   agent with a shell cannot turn on `--yes` with a `lumen` command.
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** The Tauri bundle identifier (src-tauri/tauri.conf.json): the app's config folder is named after it. */
export const APP_ID = "app.lumen.editor";

export interface EndpointEnv {
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  home?: string;
  user?: string;
}

/** The app's per-user config folder (Tauri's `app_config_dir`). `LUMEN_CONFIG_DIR` overrides it. */
export function configDir(e: EndpointEnv): string {
  if (e.env.LUMEN_CONFIG_DIR) return e.env.LUMEN_CONFIG_DIR;
  const platform = e.platform ?? process.platform;
  const home = e.home ?? os.homedir();
  if (platform === "darwin") return path.join(home, "Library", "Application Support", APP_ID);
  if (platform === "win32") return path.join(e.env.APPDATA ?? path.join(home, "AppData", "Roaming"), APP_ID);
  return path.join(e.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), APP_ID);
}

/** The socket path or pipe name for this user. */
export function endpointFor(e: EndpointEnv): string {
  const platform = e.platform ?? process.platform;
  const dir = configDir(e);
  if (platform === "win32") {
    const user = e.user ?? e.env.USERNAME ?? "user";
    const tag = createHash("sha256").update(`${user}\0${dir}`).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\lumen-cli-${tag}`;
  }
  // A Unix socket path must stay under ~104 bytes: prefer the short runtime folder.
  const runtime = e.env.XDG_RUNTIME_DIR;
  const p = path.join(runtime && runtime.length < 60 ? runtime : dir, "lumen-cli.sock");
  return p.length < 100 ? p : path.join(os.tmpdir(), `lumen-cli-${createHash("sha256").update(dir).digest("hex").slice(0, 12)}.sock`);
}

export interface EndpointFile {
  v: 1;
  endpoint: string;
  token: string;
  pid: number;
  /** The vault the app has open (absolute), so `lumen` can tell when it names another. */
  vault?: string;
  startedAt: string;
}

export const ENDPOINT_FILE = "cli-ipc.json";
export const SETTINGS_FILE = "cli-settings.json";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Write the endpoint file with mode 0600 in a 0700 folder. */
export async function writeEndpointFile(dir: string, f: EndpointFile): Promise<string> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, ENDPOINT_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(f) + "\n", { mode: 0o600 });
  await fs.chmod(tmp, 0o600).catch(() => {});
  await fs.rename(tmp, file);
  return file;
}

export async function readEndpointFile(dir: string): Promise<EndpointFile | null> {
  try {
    const v = JSON.parse(await fs.readFile(path.join(dir, ENDPOINT_FILE), "utf8")) as EndpointFile;
    return v && v.v === 1 && typeof v.endpoint === "string" && typeof v.token === "string" && v.token.length >= 32 ? v : null;
  } catch {
    return null;
  }
}

export interface CliSettings {
  /** `--yes` writes without the review screen. Off unless the user turned it on in the app. */
  allowYes: boolean;
}

export async function readSettings(dir: string): Promise<CliSettings> {
  try {
    const v = JSON.parse(await fs.readFile(path.join(dir, SETTINGS_FILE), "utf8")) as Partial<CliSettings>;
    return { allowYes: v?.allowYes === true };
  } catch {
    return { allowYes: false };
  }
}

/** Constant-time token check. */
export function tokenMatches(expected: string, got: unknown): boolean {
  if (typeof got !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
