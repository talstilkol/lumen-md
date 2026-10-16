/**
 * Pure helpers for the research worker: which URLs it may fetch, and how a
 * fetched HTML page becomes plain text. No Workers APIs, so they're unit
 * tested in Node.
 */

/** Hostnames that never leave the operator's network. */
const BLOCKED_HOSTS = /^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback|metadata\.google\.internal)$|\.(local|localhost|internal|lan|home|corp|intranet)$/i;

function ipv4Private(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * May the worker fetch this URL? Public http(s) only: no credentials in the
 * URL, no IP literals in private / loopback / link-local ranges, no
 * internal hostnames, default ports only.
 */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.test(host)) return false;
  if (ipv4Private(host)) return false;
  // IPv6 literals: refuse all (loopback, ULA, link-local, mapped v4…).
  if (host.includes(":")) return false;
  // Bare numbers / hex hosts some resolvers treat as IPv4.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return false;
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Elements whose content is never article text. */
const DROP = ["script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form", "iframe", "button", "select"];
const BLOCK = /<\/?(p|div|section|article|main|h[1-6]|li|ul|ol|tr|table|blockquote|pre|br|hr|dd|dt|figcaption)\b[^>]*>/gi;

/**
 * Readable text of an HTML page: title, then the main content (`<article>`
 * or `<main>` when present, else `<body>`), without scripts, navigation,
 * headers / footers and markup; block elements become line breaks.
 */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim());
  let body = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ?? /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  body = body.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROP) body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  body = body.replace(BLOCK, "\n").replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v\u00a0]+/g, " ").replace(/ ([,.;:!?)])/g, "$1").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

/** Normalise for quote matching: case, quotes / dashes, whitespace. */
export function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}
