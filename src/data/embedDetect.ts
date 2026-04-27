/**
 * Single source of truth for "is this URL something Lumen knows how to embed?"
 *
 * Used by both `EmbedBlock` (renderer) and the source-editor's hint extension
 * (which proposes wrapping a bare URL in an ```embed fence).
 */

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "YouTube", re: /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/i },
  { name: "Vimeo", re: /^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?\d+/i },
  { name: "Loom", re: /^https?:\/\/(?:www\.)?loom\.com\/share\/\w+/i },
  { name: "Spotify", re: /^https?:\/\/open\.spotify\.com\/(track|album|playlist|episode|show)\/\w+/i },
  { name: "SoundCloud", re: /^https?:\/\/(?:www\.)?soundcloud\.com\/[\w-]+\/[\w-]+/i },
  { name: "CodePen", re: /^https?:\/\/codepen\.io\/[^/]+\/pen\/\w+/i },
  { name: "CodeSandbox", re: /^https?:\/\/codesandbox\.io\/(?:s|p\/sandbox)\/[\w-]+/i },
  { name: "Figma", re: /^https?:\/\/(?:www\.)?figma\.com\/(file|proto|design|community\/file)\//i },
  { name: "Google Maps", re: /^https?:\/\/(?:www\.)?google\.[a-z.]+\/maps/i },
  { name: "OpenStreetMap", re: /^https?:\/\/(?:www\.)?openstreetmap\.org\//i },
  { name: "X / Twitter", re: /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^/]+\/status\/\d+/i },
  { name: "Facebook", re: /^https?:\/\/(?:www\.)?facebook\.com\/.+\/(?:posts|videos)\//i },
  { name: "Instagram", re: /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+/i },
  { name: "TikTok", re: /^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/i },
  { name: "Reddit", re: /^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\/[^/]+\/comments\/[^/]+/i },
  // LinkedIn accepts either the official embed-share URL
  // (`linkedin.com/embed/feed/update/urn:li:share:…`) or the regular post
  // URL (`linkedin.com/posts/…`). EmbedBlock converts the latter on the fly.
  { name: "LinkedIn", re: /^https?:\/\/(?:www\.)?linkedin\.com\/(?:embed\/feed\/update\/urn[\w:%-]+|posts\/[\w%-]+)/i },
  { name: "GitHub Gist", re: /^https?:\/\/gist\.github\.com\/[^/]+\/\w+/i },
];

/** Returns the platform name for a URL Lumen can embed, or null otherwise. */
export function detectEmbed(url: string): string | null {
  const u = url.trim();
  for (const p of PATTERNS) if (p.re.test(u)) return p.name;
  return null;
}
