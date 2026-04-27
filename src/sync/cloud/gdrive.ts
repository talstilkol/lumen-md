/**
 * Google Drive cloud-sync provider — symmetric to dropbox.ts.
 *
 * Uses Google's REST v3 API directly (no SDK), with the OAuth 2.0 PKCE
 * flow so the browser never sees a client secret. We scope to
 * `drive.file` so the app can only read / write files it created or that
 * the user opened with the Lumen picker — Drive's app-folder equivalent.
 *
 * Environment:
 *   - VITE_GDRIVE_CLIENT_ID   — Google Cloud Console OAuth client (Web).
 *   - VITE_GDRIVE_REDIRECT    — defaults to `${origin}/oauth/gdrive`.
 *
 * Tokens land in `localStorage["lumen.cloud.gdrive.token"]` and refresh
 * silently on 401. The bound folder defaults to a Lumen-specific app
 * folder (`appProperties.lumen=true`) so cross-app contamination is
 * impossible without the user explicitly picking other files.
 */

import { log } from "../../lib/logger";
import type { CloudFile, CloudProvider } from "./types";

const TOKEN_KEY = "lumen.cloud.gdrive.token";
const REFRESH_KEY = "lumen.cloud.gdrive.refresh";
const PKCE_KEY = "lumen.cloud.gdrive.pkce";

interface TokenSet {
  access: string;
  refresh?: string;
  expiresAt: number;
}

function clientId(): string {
  return (
    (import.meta as ImportMeta & { env?: { VITE_GDRIVE_CLIENT_ID?: string } })
      .env?.VITE_GDRIVE_CLIENT_ID ?? ""
  );
}

function redirectUri(): string {
  const env = (
    import.meta as ImportMeta & { env?: { VITE_GDRIVE_REDIRECT?: string } }
  ).env?.VITE_GDRIVE_REDIRECT;
  return env ?? `${location.origin}/oauth/gdrive`;
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

async function sha256B64Url(input: string): Promise<string> {
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
  if (!refresh) throw new Error("Google Drive is disconnected — sign in again.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId(),
    }),
  });
  if (!res.ok) {
    clearToken();
    throw new Error(`Google refresh failed (${res.status})`);
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

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const access = await getAccessToken();
  const url = path.startsWith("http") ? path : `https://www.googleapis.com${path}`;
  const headers = new Headers(opts.headers ?? {});
  headers.set("Authorization", `Bearer ${access}`);
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive ${res.status}: ${text.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? await res.json() : await res.text()) as T;
}

/* ─── Folder management ──────────────────────────────────────────────── */

async function ensureLumenFolder(): Promise<string> {
  // Look for an existing folder marked with appProperties.lumen=true.
  const search = await api<{ files: { id: string }[] }>(
    `/drive/v3/files?q=${encodeURIComponent(
      "mimeType='application/vnd.google-apps.folder' and appProperties has { key='lumen' and value='true' } and trashed=false",
    )}&fields=files(id,name)`,
  );
  if (search.files.length > 0) return search.files[0].id;
  const created = await api<{ id: string }>("/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Lumen",
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { lumen: "true" },
    }),
  });
  return created.id;
}

/* ─── Provider implementation ────────────────────────────────────────── */

export const gdriveProvider: CloudProvider = {
  name: "gdrive",
  isConnected(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  },
  async connect(): Promise<void> {
    if (!clientId()) {
      throw new Error("VITE_GDRIVE_CLIENT_ID is not set — see .env.example.");
    }
    const verifier = randomString(64);
    const challenge = await sha256B64Url(verifier);
    localStorage.setItem(PKCE_KEY, verifier);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId());
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent"); // force refresh-token issuance
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    location.assign(url.toString());
  },
  async disconnect(): Promise<void> {
    clearToken();
  },
  async listFiles(): Promise<CloudFile[]> {
    const folder = await ensureLumenFolder();
    type Entry = {
      id: string;
      name: string;
      size?: string;
      modifiedTime?: string;
      md5Checksum?: string;
    };
    const out: CloudFile[] = [];
    let pageToken: string | undefined;
    do {
      const url =
        `/drive/v3/files?q=${encodeURIComponent(`'${folder}' in parents and trashed=false`)}` +
        `&fields=nextPageToken,files(id,name,size,modifiedTime,md5Checksum)` +
        (pageToken ? `&pageToken=${pageToken}` : "");
      const page = await api<{ nextPageToken?: string; files: Entry[] }>(url);
      for (const f of page.files) {
        out.push({
          path: f.name,
          size: Number(f.size ?? 0),
          modified: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
          hash: f.md5Checksum,
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  },
  async readFile(path: string): Promise<string> {
    const folder = await ensureLumenFolder();
    const search = await api<{ files: { id: string }[] }>(
      `/drive/v3/files?q=${encodeURIComponent(
        `'${folder}' in parents and name='${path.replace(/'/g, "\\'")}' and trashed=false`,
      )}&fields=files(id)`,
    );
    if (!search.files[0]) throw new Error(`Not found: ${path}`);
    return api<string>(
      `/drive/v3/files/${search.files[0].id}?alt=media`,
    );
  },
  async writeFile(path: string, content: string): Promise<void> {
    const folder = await ensureLumenFolder();
    // Multipart upload: metadata JSON + body.
    const search = await api<{ files: { id: string }[] }>(
      `/drive/v3/files?q=${encodeURIComponent(
        `'${folder}' in parents and name='${path.replace(/'/g, "\\'")}' and trashed=false`,
      )}&fields=files(id)`,
    );
    const existing = search.files[0]?.id ?? null;
    const boundary = "lumen-" + Math.random().toString(36).slice(2);
    const meta = existing
      ? {}
      : { name: path, parents: [folder], mimeType: "text/markdown" };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/markdown\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;
    const url = existing
      ? `/upload/drive/v3/files/${existing}?uploadType=multipart`
      : "/upload/drive/v3/files?uploadType=multipart";
    await api(url, {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  },
  async deleteFile(path: string): Promise<void> {
    try {
      const folder = await ensureLumenFolder();
      const search = await api<{ files: { id: string }[] }>(
        `/drive/v3/files?q=${encodeURIComponent(
          `'${folder}' in parents and name='${path.replace(/'/g, "\\'")}' and trashed=false`,
        )}&fields=files(id)`,
      );
      const id = search.files[0]?.id;
      if (id) await api(`/drive/v3/files/${id}`, { method: "DELETE" });
    } catch (err) {
      log.warn("gdrive delete failed", err);
    }
  },
};

/** Completes the OAuth handshake. Call from the redirect handler. */
export async function finishGDriveOAuth(code: string): Promise<void> {
  const verifier = localStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("Missing PKCE verifier — restart sign-in.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId(),
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
