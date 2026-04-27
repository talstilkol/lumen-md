/**
 * Lumen publishing edge worker (Cloudflare).
 *
 * Implements the contract `src/sync/publish.ts` expects:
 *
 *   POST /              { path, content, slug?, visibility } → { url, slug }
 *   DELETE /<slug>      → 204
 *   GET    /p/<slug>    → rendered HTML page
 *
 * Storage backend: Cloudflare KV. The KV value is the raw markdown — we
 * server-render to HTML on the GET path so the worker stays free-tier
 * friendly (cached at the edge by Cloudflare automatically). Bind a KV
 * namespace called `PUBLISHED` in wrangler.toml.
 *
 * The renderer used here is intentionally minimal (basic markdown + Shiki
 * via dynamic import) — the public Read view doesn't need every Lumen
 * block type. The full pipeline lives in the SPA.
 */

interface Env {
  PUBLISHED: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string }): Promise<{ keys: { name: string; metadata?: unknown }[] }>;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Lumen-Key",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname.startsWith("/p/")) {
      const slug = url.pathname.slice(3);
      return renderPage(slug, env);
    }
    if (req.method === "GET" && /^\/feed\/[\w-]+\.xml$/.test(url.pathname)) {
      const handle = url.pathname.replace(/^\/feed\/|\.xml$/g, "");
      return renderFeed(handle, url, env);
    }
    if (req.method === "POST" && url.pathname === "/") {
      return upsert(req, env);
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/")) {
      const slug = url.pathname.slice(1);
      return remove(slug, req, env);
    }
    return new Response("Not found", { status: 404 });
  },
};

/** Render an RSS 2.0 feed of a user's public published notes. */
async function renderFeed(handle: string, baseUrl: URL, env: Env): Promise<Response> {
  const list = await env.PUBLISHED.list({ prefix: "note:" });
  const items: { slug: string; title: string; updated: string }[] = [];
  for (const k of list.keys.slice(0, 100)) {
    const meta = (k.metadata ?? {}) as {
      uid?: string;
      path?: string;
      visibility?: string;
      updatedAt?: string;
    };
    if (meta.visibility !== "public" || meta.uid !== handle) continue;
    const slug = k.name.slice(5);
    items.push({
      slug,
      title: meta.path ?? slug,
      updated: meta.updatedAt ?? new Date().toISOString(),
    });
  }
  const origin = baseUrl.origin;
  const xmlItems = items
    .map(
      (it) =>
        `<item><title>${esc(it.title)}</title><link>${origin}/p/${encodeURIComponent(it.slug)}</link><guid>${origin}/p/${encodeURIComponent(it.slug)}</guid><pubDate>${new Date(it.updated).toUTCString()}</pubDate></item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Lumen — ${esc(handle)}</title>
<link>${origin}/feed/${esc(handle)}.xml</link>
<description>Public notes published with Lumen.</description>
<language>en</language>
${xmlItems}
</channel></rss>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string,
  );
}

async function authedUser(req: Request, env: Env): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("Missing bearer token");
  const jwt = auth.slice(7);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_SERVICE_ROLE },
  });
  if (!res.ok) throw new Error("Invalid token");
  const u = (await res.json()) as { id?: string };
  if (!u.id) throw new Error("No user id");
  return u.id;
}

async function slugFor(content: string, candidate?: string): Promise<string> {
  if (candidate?.trim()) {
    return candidate.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(buf).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function upsert(req: Request, env: Env): Promise<Response> {
  let uid: string;
  try {
    uid = await authedUser(req, env);
  } catch (e) {
    return new Response((e as Error).message, { status: 401, headers: CORS });
  }
  const { path, content, slug, visibility } = (await req.json()) as {
    path: string;
    content: string;
    slug?: string;
    visibility?: "public" | "unlisted";
  };
  const finalSlug = await slugFor(content, slug);
  await env.PUBLISHED.put(`note:${finalSlug}`, content, {
    metadata: {
      uid,
      path,
      visibility: visibility ?? "public",
      updatedAt: new Date().toISOString(),
    },
  });
  const origin = new URL(req.url).origin.replace(/\/$/, "");
  return new Response(
    JSON.stringify({ url: `${origin}/p/${finalSlug}`, slug: finalSlug }),
    { headers: { "Content-Type": "application/json", ...CORS } },
  );
}

async function remove(slug: string, req: Request, env: Env): Promise<Response> {
  try {
    await authedUser(req, env);
  } catch (e) {
    return new Response((e as Error).message, { status: 401, headers: CORS });
  }
  await env.PUBLISHED.delete(`note:${slug}`);
  return new Response(null, { status: 204, headers: CORS });
}

async function renderPage(slug: string, env: Env): Promise<Response> {
  const md = await env.PUBLISHED.get(`note:${slug}`);
  if (!md) return new Response("Not found", { status: 404 });
  // Minimal markdown → HTML — headings, paragraphs, code, links, lists.
  const html = markdownToHtml(md);
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lumen · /p/${slug}</title>
<style>
  body { max-width: 720px; margin: 40px auto; padding: 0 20px;
         font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
         line-height: 1.7; color: #1a1a2e; }
  pre { background: #f5f5f7; padding: 12px; border-radius: 8px; overflow-x: auto; }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.9em; }
  a { color: #6d4cff; }
  hr { border: 0; border-top: 1px solid #e5e5ec; margin: 32px 0; }
  footer { margin-top: 48px; color: #888; font-size: 12px; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d0d18; color: #e8e8f0; }
    pre { background: #1a1a2e; }
    hr { border-top-color: #2a2a3e; }
  }
</style>
</head><body>${html}<footer>Published with <a href="https://lumen.app">Lumen</a></footer></body></html>`;
  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

/** Tiny, dependency-free markdown renderer for the public read view. */
function markdownToHtml(src: string): string {
  // Strip frontmatter.
  src = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return src
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code}</code></pre>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^---$/gm, "<hr />")
    .replace(/^\s*-\s+(.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*?<\/li>(\s*<li>.*?<\/li>)*)/gs, "<ul>$1</ul>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    .replace(/<p>(<h[1-3]|<hr|<pre|<ul)/g, "$1")
    .replace(/(<\/h[1-3]>|<\/pre>|<\/ul>|<hr \/>)<\/p>/g, "$1");
}
