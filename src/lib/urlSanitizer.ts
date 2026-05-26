const BAD_URL_PREFIX = /^(?:javascript|vbscript):/i;
// Safe data: URL whitelist — only base64-encoded image payloads in
// well-known formats. Anything else is rejected by the catch-all data:
// check below.
const SAFE_DATA_URL =
  /^data:image\/(?:svg\+xml|png|jpe?g|gif|webp);base64,/i;

export function sanitizeUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/<|>/.test(value)) return false;
  if (/\x00/.test(value)) return false;
  if (BAD_URL_PREFIX.test(value)) return false;
  // Whitelisted data: image URL — accept before the catch-all data: reject.
  if (SAFE_DATA_URL.test(value)) {
    return true;
  }
  if (BAD_URL_PREFIX.test(value)) return false;
  if (/^data:/i.test(value)) {
    return false;
  }
  if (value.startsWith("//")) return false;
  if (!/^\w+:/.test(value) && !value.startsWith("/") && !value.startsWith("./") && !value.startsWith("../")) {
    return false;
  }
  try {
    new URL(value, window.location.href);
    return true;
  } catch {
    return false;
  }
}
