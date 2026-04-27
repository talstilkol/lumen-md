/**
 * Live SVG block — renders raw `<svg>` markup safely. We sanitise out
 * any `<script>` / event-handler attributes before mounting, then drop
 * the cleaned XML into a host div via `dangerouslySetInnerHTML`.
 *
 * Why not `htmlpreview`: an SVG-only fence is the ergonomic equivalent
 * of a Mermaid block — a one-liner `<svg viewBox="…">…</svg>` should
 * render inline without iframe boilerplate. The sanitiser mitigates
 * the XSS risk that drove the broader `htmlpreview` to use a sandbox.
 */

import { useMemo } from "react";

interface Props {
  source: string;
  meta?: string;
}

const SANITIZE_TAGS = /<\s*\/?\s*script\b[^>]*>/gi;
const SANITIZE_EVENT_ATTRS = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^>\s]+)/gi;
const SANITIZE_JS_HREF = /\s+(href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi;

function sanitizeSvg(input: string): string {
  return input
    .replace(SANITIZE_TAGS, "")
    .replace(SANITIZE_EVENT_ATTRS, "")
    .replace(SANITIZE_JS_HREF, "");
}

export default function LiveSvgBlock({ source, meta }: Props) {
  const heightMatch = meta?.match(/height=(\d+)/);
  const sanitized = useMemo(() => sanitizeSvg(source.trim()), [source]);
  // If the user pasted a fragment, wrap it in an outer <svg>.
  const wrapped = sanitized.startsWith("<svg")
    ? sanitized
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${sanitized}</svg>`;
  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span>SVG</span>
      </div>
      <div
        style={{
          padding: 12,
          background: "hsl(var(--bg-subtle))",
          maxHeight: heightMatch ? Number(heightMatch[1]) : 360,
          overflow: "auto",
          textAlign: "center",
        }}
        dangerouslySetInnerHTML={{ __html: wrapped }}
      />
    </div>
  );
}
