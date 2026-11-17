/**
 * OneNote through Microsoft Graph (plan W10.E49, W1.26): every notebook,
 * section group, section and page of the signed-in account, imported
 * without exporting `.mht` files by hand.
 *
 * Sign-in is OAuth 2.0 authorization code with PKCE (RFC 7636) against the
 * Microsoft identity platform, as a public client: no secret, the scope
 * `Notes.Read` (read only) and `offline_access`. The token lives in memory
 * for the import and is never stored. It is only ever sent to
 * https://graph.microsoft.com: a resource URL on any other host is skipped.
 *
 * Graph v1.0 calls used:
 *   GET /me/onenote/sectionGroups?$expand=parentNotebook,parentSectionGroup
 *   GET /me/onenote/sections?$expand=parentNotebook,parentSectionGroup
 *   GET /me/onenote/sections/{id}/pages?$select=…&$top=100   (follows @odata.nextLink)
 *   GET /me/onenote/pages/{id}/content                       (the page's HTML)
 *   GET /me/onenote/resources/{id}/$value                     (images, attached files)
 * 429 and 503 are retried after Retry-After (at most 5 tries).
 *
 * Turning it on (the owner): register an app in Microsoft Entra (SPA, the
 * redirect URI below), put its client id in the deployment's
 * `/lumen-runtime.json` (W4.19, onenoteClientId.ts: a runtime config, not a
 * build variable), and add https://login.microsoftonline.com and
 * https://graph.microsoft.com to VITE_CSP_CONNECT_EXTRA. A user can also
 * enter their own app's client id in the import wizard. Without a client id
 * the sign-in is not offered.
 */

import { oneNoteClientId } from "./onenoteClientId";
import { htmlToNote } from "./html";
import { claimPath, dirOf, mdEmbed, safeName } from "./names";
import { isoDate, withFrontmatter } from "./frontmatter";
import { emptyVault, type ConvertedVault } from "./types";

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const GRAPH_ORIGIN = "https://graph.microsoft.com";
export const SCOPES = ["Notes.Read", "offline_access"] as const;

export interface OneNoteAuthConfig {
  clientId: string;
  redirectUri: string;
  /** "common" (work, school and personal accounts), "consumers", "organizations" or a tenant id. */
  tenant?: string;
}

/** The app's configuration, or null when no client id is set (then the sign-in is not offered). */
export function oneNoteConfig(origin: string = typeof location !== "undefined" ? location.origin : ""): OneNoteAuthConfig | null {
  const clientId = oneNoteClientId();
  if (!clientId || !origin) return null;
  return { clientId, redirectUri: `${origin}/oauth/onenote`, tenant: "common" };
}

const authority = (c: OneNoteAuthConfig) => `https://login.microsoftonline.com/${encodeURIComponent(c.tenant || "common")}/oauth2/v2.0`;

// ── PKCE ─────────────────────────────────────────────────────────────

export function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The S256 code challenge of a verifier (RFC 7636 §4.2). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** A fresh verifier (32 random bytes, 43 characters) and its challenge. */
export async function createPkce(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = base64Url(random(32));
  return { verifier, challenge: await codeChallenge(verifier), state: base64Url(random(16)) };
}

/** Where to send the browser to sign in. */
export function authorizeUrl(c: OneNoteAuthConfig, pkce: { challenge: string; state: string }): string {
  const u = new URL(`${authority(c)}/authorize`);
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", c.redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", pkce.state);
  u.searchParams.set("code_challenge", pkce.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export interface OneNoteTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ms since the epoch. */
  expiresAt: number;
}

export class OneNoteAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** The redirect back: the code, after checking `state`; an `error` from the identity platform throws. */
export function readRedirect(url: string, expectedState: string): string {
  const q = new URL(url).searchParams;
  const err = q.get("error");
  if (err) throw new OneNoteAuthError(q.get("error_description") || err, err);
  if (!expectedState || q.get("state") !== expectedState) throw new OneNoteAuthError("the sign-in answer does not match this sign-in (state)", "state_mismatch");
  const code = q.get("code");
  if (!code) throw new OneNoteAuthError("the sign-in answer has no code", "no_code");
  return code;
}

async function tokenRequest(c: OneNoteAuthConfig, body: Record<string, string>, fetcher: typeof fetch, now: () => number): Promise<OneNoteTokens> {
  const res = await fetcher(`${authority(c)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, scope: SCOPES.join(" "), ...body }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new OneNoteAuthError(json.error_description || `token request failed (${res.status})`, json.error || `http_${res.status}`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null, expiresAt: now() + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000 };
}

export function exchangeCode(c: OneNoteAuthConfig, code: string, verifier: string, fetcher: typeof fetch = fetch, now = Date.now): Promise<OneNoteTokens> {
  return tokenRequest(c, { grant_type: "authorization_code", code, redirect_uri: c.redirectUri, code_verifier: verifier }, fetcher, now);
}

export function refreshTokens(c: OneNoteAuthConfig, refreshToken: string, fetcher: typeof fetch = fetch, now = Date.now): Promise<OneNoteTokens> {
  return tokenRequest(c, { grant_type: "refresh_token", refresh_token: refreshToken }, fetcher, now);
}

// ── Graph ────────────────────────────────────────────────────────────

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface GraphOptions {
  fetch?: typeof fetch;
  /** Waits between retries; tests pass one that doesn't wait. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  maxTries?: number;
}

/** True for a URL the token may be sent to. */
export function isGraphUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.origin === GRAPH_ORIGIN;
  } catch {
    return false;
  }
}

export class GraphClient {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(
    private readonly token: () => string | Promise<string>,
    private readonly opts: GraphOptions = {},
  ) {
    // privacy-ledger: not tracked — Microsoft Graph, only after the user signs in to import their own OneNote (Notes.Read); request() sends nothing outside graph.microsoft.com (isGraphUrl). Airplane mode blocks and lists it.
    this.fetcher = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** One request to Graph, retried on 429/503. Never leaves graph.microsoft.com. */
  async request(pathOrUrl: string): Promise<Response> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
    if (!isGraphUrl(url)) throw new GraphError(`refusing to send the token outside Microsoft Graph: ${new URL(url).origin}`, 0, "not_graph");
    const tries = this.opts.maxTries ?? 5;
    for (let attempt = 1; ; attempt++) {
      this.opts.signal?.throwIfAborted();
      const res = await this.fetcher(url, { headers: { Authorization: `Bearer ${await this.token()}` }, signal: this.opts.signal });
      if (res.ok) return res;
      if ((res.status === 429 || res.status === 503) && attempt < tries) {
        const after = Number(res.headers.get("Retry-After"));
        await this.sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 120) * 1000 : 2 ** attempt * 500);
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new GraphError(body.error?.message || `Graph ${res.status}`, res.status, body.error?.code || `http_${res.status}`);
    }
  }

  async json<T>(path: string): Promise<T> {
    return (await this.request(path)).json() as Promise<T>;
  }

  /** Every item of a collection, following @odata.nextLink. */
  async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    for (let pages = 0; next; pages++) {
      if (pages > 1000) throw new GraphError("a collection pages on without end", 0, "too_many_pages");
      const page: { value?: T[]; "@odata.nextLink"?: string } = await this.json(next);
      out.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
    }
    return out;
  }
}

interface Named {
  id: string;
  displayName?: string;
  parentNotebook?: { id: string; displayName?: string } | null;
  parentSectionGroup?: { id: string; displayName?: string } | null;
}

export interface OneNotePage {
  id: string;
  title?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  level?: number;
  order?: number;
}

/** Each section with its folder path: notebook / section group … / section. */
export async function listSections(g: GraphClient): Promise<{ id: string; path: string }[]> {
  const groups = await g.list<Named>("/me/onenote/sectionGroups?$expand=parentNotebook,parentSectionGroup&$select=id,displayName");
  const sections = await g.list<Named>("/me/onenote/sections?$expand=parentNotebook,parentSectionGroup&$select=id,displayName");
  const byId = new Map(groups.map((x) => [x.id, x]));
  const groupPath = (id: string, depth = 0): string => {
    const grp = byId.get(id);
    if (!grp || depth > 50) return "";
    const up = grp.parentSectionGroup ? groupPath(grp.parentSectionGroup.id, depth + 1) : safeName(grp.parentNotebook?.displayName ?? "", "Notebook");
    return `${up}/${safeName(grp.displayName ?? "", "Section group")}`;
  };
  return sections.map((s) => {
    const up = s.parentSectionGroup ? groupPath(s.parentSectionGroup.id) : safeName(s.parentNotebook?.displayName ?? "", "Notebook");
    return { id: s.id, path: `${up}/${safeName(s.displayName ?? "", "Section")}` };
  });
}

/** `<object data-attachment=… data=…>` → a link htmlToNote keeps; images: the full-resolution source. */
export function prepareOneNoteHtml(html: string): string {
  return html
    .replace(/<object\b([^>]*)>(?:\s*<\/object>)?/gi, (_m, attrs: string) => {
      const name = /data-attachment="([^"]*)"/i.exec(attrs)?.[1] ?? "attachment";
      const data = /\sdata="([^"]*)"/i.exec(attrs)?.[1];
      return data ? `<p><a href="${data}">${name}</a></p>` : "";
    })
    .replace(/<img\b([^>]*?)\sdata-fullres-src="([^"]*)"([^>]*)>/gi, (_m, a: string, full: string, b: string) => `<img${a.replace(/\ssrc="[^"]*"/i, "")} src="${full}"${b.replace(/\ssrc="[^"]*"/i, "")}>`);
}

const decodeAttr = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const RESOURCE = /^https:\/\/graph\.microsoft\.com\/v1\.0\/(?:me|users\/[^/]+|groups\/[^/]+|sites\/[^/]+)\/onenote\/resources\/[^/]+\/(?:\$value|content)$/;

export interface OneNoteImportOptions {
  onProgress?: (done: number, total: number) => void;
  /** Stop after this many pages (a preview). */
  limit?: number;
}

/** The signed-in account's OneNote → a converted vault. */
export async function convertOneNoteGraph(g: GraphClient, opts: OneNoteImportOptions = {}): Promise<ConvertedVault> {
  const vault = emptyVault();
  const taken = new Set<string>();
  const attachmentTaken = new Set<string>();
  const sections = await listSections(g);
  const pagesBySection: { path: string; page: OneNotePage }[] = [];
  for (const s of sections) {
    const pages = await g.list<OneNotePage>(`/me/onenote/sections/${encodeURIComponent(s.id)}/pages?$select=id,title,createdDateTime,lastModifiedDateTime,level,order&$top=100`);
    pages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const page of pages) pagesBySection.push({ path: s.path, page });
  }
  const total = Math.min(pagesBySection.length, opts.limit ?? Infinity);
  for (let i = 0; i < total; i++) {
    const { path, page } = pagesBySection[i];
    const title = (page.title ?? "").trim();
    const dest = claimPath(taken, `${path}/${safeName(title)}.md`);
    let html: string;
    try {
      html = await (await g.request(`/me/onenote/pages/${encodeURIComponent(page.id)}/content`)).text();
    } catch (e) {
      vault.skipped.push({ path: `${path}/${title || page.id}`, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) });
      opts.onProgress?.(i + 1, total);
      continue;
    }
    const prepared = prepareOneNoteHtml(html);
    // Download every resource first: htmlToNote is synchronous.
    const saved = new Map<string, string>();
    const refs = [
      ...[...prepared.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ url: decodeAttr(/\ssrc="([^"]+)"/i.exec(m[0])?.[1] ?? ""), label: decodeAttr(/\salt="([^"]*)"/i.exec(m[0])?.[1] ?? "") || "image" })),
      ...[...prepared.matchAll(/<a\b[^>]*\shref="([^"]+)"[^>]*>([^<]*)/gi)].map((m) => ({ url: decodeAttr(m[1]), label: decodeAttr(m[2]).trim() || "attachment" })),
    ];
    for (const { url, label } of refs) {
      if (saved.has(url) || !url.startsWith("https://graph.microsoft.com/")) continue;
      vault.sourceAttachments++;
      if (!RESOURCE.test(url)) {
        vault.warnings.push({ path: dest, reason: "missingAttachment", detail: `not a OneNote resource URL: ${url}` });
        continue;
      }
      try {
        const res = await g.request(url);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const ext = extFor(res.headers.get("Content-Type"), label);
        const stem = safeName(label.replace(/\.[^.]+$/, "") || "image");
        const target = claimPath(attachmentTaken, `${path}/_attachments/${stem}${ext}`);
        vault.attachments.set(target, bytes);
        saved.set(url, target);
      } catch (e) {
        vault.warnings.push({ path: dest, reason: "missingAttachment", detail: e instanceof Error ? e.message : String(e) });
      }
    }
    const md = htmlToNote(prepared, {
      image: (src, alt) => (saved.has(src) ? mdEmbed(saved.get(src)!, dirOf(dest), alt || undefined) : src.startsWith("https://graph.microsoft.com/") ? "" : null),
      link: (href, text) => (saved.has(href) ? mdEmbed(saved.get(href)!, dirOf(dest), text || undefined) : null),
    });
    if (!md.trim() && !title) {
      vault.skipped.push({ path: `${path}/${page.id}`, reason: "empty" });
      opts.onProgress?.(i + 1, total);
      continue;
    }
    const created = isoDate(page.createdDateTime ? Date.parse(page.createdDateTime) : undefined);
    const modified = isoDate(page.lastModifiedDateTime ? Date.parse(page.lastModifiedDateTime) : undefined);
    if (!created && !modified) vault.warnings.push({ path: dest, reason: "noDates" });
    vault.notes.set(dest, withFrontmatter({ created, modified }, md));
    opts.onProgress?.(i + 1, total);
  }
  return vault;
}

const MIME_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp", "application/pdf": ".pdf" };
function extFor(contentType: string | null, label: string): string {
  const own = label.match(/\.[A-Za-z0-9]{1,10}$/)?.[0];
  if (own) return own.toLowerCase();
  return MIME_EXT[(contentType ?? "").split(";")[0].trim().toLowerCase()] ?? ".bin";
}
