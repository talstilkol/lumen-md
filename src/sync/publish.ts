/**
 * Read-mode publishing — turn any note into a public URL (Pro feature).
 *
 * The flow:
 *
 *   1. Client calls `publishNote(path)` — POST {path, content, slug?} to the
 *      configured `VITE_PUBLISH_ENDPOINT` (Cloudflare Worker / Vercel edge /
 *      Supabase Edge Function — operator's choice).
 *   2. The endpoint stores the rendered HTML at `lumen.app/p/<slug>` and
 *      returns `{ url, slug }`.
 *   3. `unpublishNote(slug)` flips the document back to private.
 *
 * The server piece is intentionally out of this module. A reference
 * Cloudflare Worker that satisfies the contract is shipped under
 * `mcp-server/../publish-worker/` (TODO) — any HTTP backend that accepts
 * the same JSON shape works.
 *
 * The browser never sees a service-account key. Authorization rides on the
 * user's session JWT (Supabase / Clerk). Anonymous users hit a 401 toast
 * with "Sign in to publish".
 */

import { useAppStore } from "../store/useStore";
import { useEntitlement } from "../billing/useEntitlement";

export interface PublishResult {
  /** Public URL the note can now be read at. */
  url: string;
  /** Slug part of the URL — store on the note's frontmatter. */
  slug: string;
  /** Server-reported expiry, if any (Pro = no expiry, Free trial = 7 days). */
  expiresAt?: number;
}

function endpoint(): string {
  const env = (
    import.meta as ImportMeta & { env?: { VITE_PUBLISH_ENDPOINT?: string } }
  ).env?.VITE_PUBLISH_ENDPOINT;
  if (!env) throw new Error("VITE_PUBLISH_ENDPOINT is not set — publishing offline.");
  return env;
}

function authHeader(): Record<string, string> {
  const aiKey = useAppStore.getState().aiKey;
  // The publish endpoint accepts either a Lumen-issued JWT (after Supabase
  // sign-in) OR a workspace AI key as a soft-auth fallback for self-hosted
  // setups. The cloud Lumen instance ignores the AI-key header.
  const headers: Record<string, string> = {};
  if (aiKey) headers["X-Lumen-Key"] = aiKey;
  return headers;
}

function ensurePro(): void {
  const caps = useEntitlement.getState().capabilities;
  // Read-mode publishing is gated to Pro / Team — Free users get a clear
  // upgrade message rather than an opaque 402.
  // (Free tier could allow N publishes per month — adjust here.)
  if (!caps.cloudSync) {
    throw new Error(
      "Publishing is a Pro feature. Upgrade to share read-only links to your notes.",
    );
  }
}

/**
 * Publish a note. Optional knobs:
 *   - `slug`        — custom URL suffix; server otherwise picks a content
 *                     hash.
 *   - `visibility`  — "public" or "unlisted" (server hides from indexes).
 *   - `password`    — when set, the body is AES-GCM encrypted client-side
 *                     before upload. Only readers who know the password can
 *                     decrypt; the server stores ciphertext only.
 */
export async function publishNote(
  path: string,
  content: string,
  opts: {
    slug?: string;
    visibility?: "public" | "unlisted";
    password?: string;
  } = {},
): Promise<PublishResult> {
  ensurePro();
  const body = opts.password
    ? await encryptForPublish(content, opts.password)
    : content;
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({
      path,
      content: body,
      slug: opts.slug,
      visibility: opts.visibility ?? "public",
      encrypted: !!opts.password,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Publish failed (${res.status}): ${text.slice(0, 160)}`);
  }
  return (await res.json()) as PublishResult;
}

/**
 * Encrypt the markdown body with a user-chosen password before upload.
 * Wraps the ciphertext in a tiny self-describing JSON envelope so the
 * public read view (or any third-party reader) can decrypt with the
 * password and a few lines of WebCrypto.
 */
async function encryptForPublish(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return JSON.stringify({
    v: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iter: 200_000,
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    cipher: btoa(String.fromCharCode(...cipher)),
  });
}

export async function unpublishNote(slug: string): Promise<void> {
  ensurePro();
  const res = await fetch(`${endpoint()}/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers: authHeader(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Unpublish failed (${res.status})`);
  }
}

/** Local-only inspection: parse `published:` from the frontmatter. */
export function getPublishedSlug(content: string): string | null {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^published\s*:\s*([\w/-]+)/m);
  return m?.[1] ?? null;
}

/** Persist a slug into the note's frontmatter (idempotent). */
export function setPublishedSlug(content: string, slug: string | null): string {
  const fm = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/);
  if (!fm) {
    return slug == null ? content : `---\npublished: ${slug}\n---\n\n${content}`;
  }
  const block = fm[2];
  const has = /^published\s*:/m.test(block);
  let newBlock: string;
  if (slug == null) {
    newBlock = block.replace(/^published\s*:.*$/m, "").replace(/\n{2,}/g, "\n").trim();
  } else if (has) {
    newBlock = block.replace(/^published\s*:.*$/m, `published: ${slug}`);
  } else {
    newBlock = `${block.replace(/\s*$/, "")}\npublished: ${slug}`;
  }
  return content.replace(fm[0], `${fm[1]}${newBlock}${fm[3]}`);
}
