/**
 * Dropbox cloud-sync provider.
 *
 * Uses the public REST API (`api.dropboxapi.com`, `content.dropboxapi.com`)
 * over `fetch` — no SDK is bundled. The OAuth flow follows the PKCE variant so
 * we never have to ship a client secret in the browser.
 *
 * Environment / runtime configuration:
 *   - `VITE_DROPBOX_APP_KEY`   — your Dropbox app key (public).
 *   - `VITE_DROPBOX_REDIRECT`  — defaults to `${origin}/oauth/dropbox`.
 *
 * Tokens land in `localStorage["lumen.cloud.dropbox.token"]` and are silently
 * refreshed on 401. The bound folder defaults to `/Apps/Lumen` so Dropbox can
 * scope the app to a single sub-tree (App folder permission).
 */

import { log } from "../../lib/logger";
import type { CloudFile, CloudProvider } from "./types";

const TOKEN_KEY = "lumen.cloud.dropbox.token";
const REFRESH_KEY = "lumen.cloud.dropbox.refresh";
const FOLDER_KEY = "lumen.cloud.dropbox.folder";
const PKCE_KEY = "lumen.cloud.dropbox.pkce";

interface TokenSet {
  access: string;
  refresh?: string;
  expiresAt: number;
}

function appKey(): string {
  return (
    (import.meta as ImportMeta & { env?: { VITE_DROPBOX_APP_KEY?: string } })
      .env?.VITE_DROPBOX_APP_KEY ?? ""
  );
}

function redirectUri(): string {
  const env = (
    import.meta as ImportMeta & { env?: { VITE_DROPBOX_REDIRECT?: string } }
  ).env?.VITE_DROPBOX_REDIRECT;
  if (env) return env;
  return `${location.origin}/oauth/dropbox`;
}

function loadToken(): TokenSet | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    return null;
  }
}

function saveToken(tok: TokenSet): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tok));
  if (tok.refresh) localStorage.setItem(REFRESH_KEY, tok.refresh);
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(PKCE_KEY);
}

/* ─── PKCE helpers ───────────────────────────────────────────────────── */

async function sha256Base64Url(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const b = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(len = 64): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, len);
}

/* ─── Token plumbing ─────────────────────────────────────────────────── */

async function refreshAccessToken(): Promise<string> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) throw new Error("Dropbox is disconnected — sign in again.");
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: appKey(),
    }),
  });
  if (!res.ok) {
    clearToken();
    throw new Error(`Dropbox refresh failed (${res.status})`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  const tok: TokenSet = {
    access: json.access_token,
    refresh,
    expiresAt: Date.now() + json.expires_in * 1000 - 30_000,
  };
  saveToken(tok);
  return tok.access;
}

async function getAccessToken(): Promise<string> {
  const tok = loadToken();
  if (tok && tok.expiresAt > Date.now()) return tok.access;
  return refreshAccessToken();
}

async function api<T = unknown>(
  path: string,
  body?: unknown,
  opts: { contentEndpoint?: boolean; raw?: BodyInit; rawHeaders?: Record<string, string> } = {},
): Promise<T> {
  const access = await getAccessToken();
  const url = (opts.contentEndpoint ? "https://content.dropboxapi.com" : "https://api.dropboxapi.com") + path;
  const headers: Record<string, string> = { Authorization: `Bearer ${access}` };
  if (opts.raw) {
    Object.assign(headers, opts.rawHeaders ?? {});
  } else {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: opts.raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dropbox ${res.status}: ${text.slice(0, 200)}`);
  }
  if (opts.contentEndpoint && body === undefined) {
    return (await res.text()) as unknown as T;
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? await res.json() : await res.text()) as T;
}

/* ─── Provider implementation ────────────────────────────────────────── */

export const dropboxProvider: CloudProvider = {
  name: "dropbox",
  isConnected(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  },
  async connect(): Promise<void> {
    if (!appKey()) {
      throw new Error("VITE_DROPBOX_APP_KEY is not set — see .env.example.");
    }
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    localStorage.setItem(PKCE_KEY, verifier);
    const url = new URL("https://www.dropbox.com/oauth2/authorize");
    url.searchParams.set("client_id", appKey());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("token_access_type", "offline");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    location.assign(url.toString());
  },
  async disconnect(): Promise<void> {
    clearToken();
  },
  async listFiles(): Promise<CloudFile[]> {
    const folder = localStorage.getItem(FOLDER_KEY) ?? "";
    type Entry = {
      [".tag"]: "file" | "folder";
      path_lower: string;
      size?: number;
      server_modified?: string;
      content_hash?: string;
    };
    const out: CloudFile[] = [];
    let cursor: string | undefined;
    do {
      const body = cursor
        ? { cursor }
        : { path: folder, recursive: true, include_non_downloadable_files: false };
      const res = await api<{ entries: Entry[]; cursor?: string; has_more: boolean }>(
        cursor ? "/2/files/list_folder/continue" : "/2/files/list_folder",
        body,
      );
      for (const e of res.entries) {
        if (e[".tag"] !== "file") continue;
        out.push({
          path: e.path_lower,
          size: e.size ?? 0,
          modified: e.server_modified ? Date.parse(e.server_modified) : 0,
          hash: e.content_hash,
        });
      }
      cursor = res.has_more ? res.cursor : undefined;
    } while (cursor);
    return out;
  },
  async readFile(path: string): Promise<string> {
    return api<string>("/2/files/download", undefined, {
      contentEndpoint: true,
      rawHeaders: { "Dropbox-API-Arg": JSON.stringify({ path }) },
      raw: "",
    });
  },
  async writeFile(path: string, content: string): Promise<void> {
    await api("/2/files/upload", undefined, {
      contentEndpoint: true,
      raw: content,
      rawHeaders: {
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode: "overwrite",
          mute: true,
        }),
      },
    });
  },
  async deleteFile(path: string): Promise<void> {
    try {
      await api("/2/files/delete_v2", { path });
    } catch (err) {
      log.warn("dropbox delete failed", err);
    }
  },
};

/**
 * Completes the OAuth handshake. Call from the redirect page (or a router
 * handler that runs when `code` is present in the query string).
 */
export async function finishDropboxOAuth(code: string): Promise<void> {
  const verifier = localStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("Missing PKCE verifier — restart sign-in.");
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: appKey(),
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`OAuth exchange failed (${res.status})`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  saveToken({
    access: json.access_token,
    refresh: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000 - 30_000,
  });
  localStorage.removeItem(PKCE_KEY);
}
