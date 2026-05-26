/**
 * GitHub Gist provider — share code blocks from Lumen directly to GitHub as
 * public or private gists.  Frontmatter in the document tracks `gist_id` so
 * edits can push updates back to the same gist instead of creating a new one.
 *
 * OAuth flow uses a GitHub App or Personal Access Token (PAT).  For desktop
 * / mobile we recommend a GitHub App with device-code flow; for web we use
 * a dedicated proxy OAuth endpoint (same pattern as Dropbox / GDrive).
 *
 * Environment:
 *   - VITE_GITHUB_CLIENT_ID   — GitHub OAuth App client id.
 *   - VITE_GITHUB_PROXY       — optional token-exchange proxy URL.
 *
 * Token stored in `localStorage["lumen.cloud.github.token"]`.
 */

import { log } from "../../lib/logger";
import type { CloudProvider } from "./types";

const TOKEN_KEY = "lumen.cloud.github.token";

interface GistPayload {
  description: string;
  public: boolean;
  files: Record<string, { content: string }>;
}

interface GistResponse {
  id: string;
  html_url: string;
  files: Record<string, { raw_url: string }>;
}

function token(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function headers() {
  const t = token();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { ...headers(), "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Create or update a gist from a single code block.
 *
 * @param opts.content   code string
 * @param opts.filename  e.g. "plot.py" or "README.md"
 * @param opts.gistId    existing gist to PATCH (optional)
 * @param opts.public    default false (secret gist)
 * @returns gist URL
 */
export async function pushCodeBlock(opts: {
  content: string;
  filename: string;
  gistId?: string;
  public?: boolean;
  description?: string;
}): Promise<{ id: string; url: string }> {
  const payload: GistPayload = {
    description: opts.description ?? `Shared from Lumen — ${opts.filename}`,
    public: opts.public ?? false,
    files: { [opts.filename]: { content: opts.content } },
  };

  if (opts.gistId) {
    const updated = await api<GistResponse>(`/gists/${opts.gistId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return { id: updated.id, url: updated.html_url };
  }

  const created = await api<GistResponse>("/gists", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { id: created.id, url: created.html_url };
}

/**
 * OAuth device-code flow starter (desktop / CLI friendly).
 */
export async function startGitHubDeviceAuth(clientId: string): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
}> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: "gist" }),
  });
  if (!res.ok) throw new Error(`GitHub device code failed: ${res.status}`);
  const json = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    interval: json.interval,
  };
}

/**
 * Poll for device-code token.
 */
export async function pollGitHubDeviceToken(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
): Promise<string> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (true) {
    await wait(intervalSeconds * 1000);
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const json = (await res.json()) as { access_token?: string; error?: string };
    if (json.access_token) {
      localStorage.setItem(TOKEN_KEY, json.access_token);
      return json.access_token;
    }
    if (json.error === "authorization_pending") continue;
    if (json.error === "slow_down") {
      intervalSeconds += 5;
      continue;
    }
    throw new Error(`GitHub device auth error: ${json.error ?? "unknown"}`);
  }
}

/**
 * Minimal CloudProvider-compatible wrapper so the sync engine can treat
 * Gist as a read-only folder of gists (each gist = one "file").
 */
export const gistProvider: CloudProvider = {
  name: "GitHub Gist",
  isConnected() { return !!token(); },
  async connect() {
    const clientId =
      (import.meta as ImportMeta & { env?: { VITE_GITHUB_CLIENT_ID?: string } }).env
        ?.VITE_GITHUB_CLIENT_ID ?? "";
    if (!clientId) throw new Error("Missing VITE_GITHUB_CLIENT_ID");
    const flow = await startGitHubDeviceAuth(clientId);
    log.info("GitHub device auth started:", flow.verificationUri, "code", flow.userCode);
    await pollGitHubDeviceToken(clientId, flow.deviceCode, flow.interval);
  },
  async disconnect() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  },
  async listFiles() {
    const items = await api<Array<{ id: string; description: string; updated_at: string }>>("/gists");
    return items.map((g) => ({
      path: `${g.id}.md`,
      size: 0,
      modified: new Date(g.updated_at).getTime(),
      hash: g.id,
    }));
  },
  async readFile(path: string) {
    const id = path.replace(/\.md$/, "");
    const g = await api<GistResponse>(`/gists/${id}`);
    const files = Object.values(g.files);
    return files.map((f) => f.raw_url).join("\n\n");
  },
  async writeFile(path: string, content: string) {
    const id = path.replace(/\.md$/, "");
    await pushCodeBlock({ content, filename: "snippet.md", gistId: id });
  },
  async deleteFile(path: string) {
    const id = path.replace(/\.md$/, "");
    await api(`/gists/${id}`, { method: "DELETE" });
  },
};
