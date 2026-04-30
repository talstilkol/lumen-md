const BAD_URL_PREFIX = /^(?:javascript|vbscript|data):/i;

export function sanitizeUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/<|>/.test(value)) return false;
  if (/\x00/.test(value)) return false;
  if (BAD_URL_PREFIX.test(value)) return false;
  if (
    /^data:image\/(?:svg\+xml|png|jpe?g|gif|webp);base64,/i.test(value)
  ) {
    return true;
  }
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
