/**
 * Live CSS preview — type CSS in the fence body, see it applied to a
 * miniature HTML scaffold inside a sandboxed iframe. Useful for quick
 * "what does this gradient look like?" notes without dragging in a
 * full HTML preview block.
 *
 * The default scaffold renders a card + button + heading so most CSS
 * snippets have a meaningful target. Override the demo HTML via fence
 * meta:
 *
 *     ```live-css html='<button class="b">Click</button>'
 *     .b { padding: 8px 12px; border-radius: 6px; … }
 *     ```
 *
 * Same sandbox rules as `htmlpreview`: no `allow-same-origin` so the
 * style sheet can't reach the parent.
 */

import { useMemo, useRef, useState } from "react";
import { Maximize2, Code2 } from "lucide-react";
import { t } from "../i18n";

interface Props {
  source: string;
  meta?: string;
}

const DEFAULT_HTML = `
<article class="card">
  <h1>Live CSS preview</h1>
  <p>Edit the CSS in the source pane — this card restyles in real time.</p>
  <button class="btn">Click me</button>
</article>
`;

export default function LiveCssBlock({ source, meta }: Props) {
  const heightMatch = meta?.match(/height=(\d+)/);
  const height = heightMatch ? Number(heightMatch[1]) : 280;
  const htmlMatch = meta?.match(/html=(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/);
  const html = htmlMatch?.[1] ?? htmlMatch?.[2] ?? htmlMatch?.[3] ?? DEFAULT_HTML;

  const [showSource, setShowSource] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8" /><style>${source}</style></head><body>${html}</body></html>`,
    [source, html],
  );

  return (
    <div className="chart-block" ref={containerRef}>
      <div className="chart-block-header">
        <span>{t("block.liveCss.title")}</span>
        <div className="chart-block-tabs">
          <button
            type="button"
            className={`chart-block-tab ${showSource ? "active" : ""}`}
            aria-pressed={showSource}
            onClick={() => setShowSource((v) => !v)}
            title={t("block.htmlPreview.toggleSource")}
          >
            <Code2 size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
            {t("block.htmlPreview.source")}
          </button>
        </div>
      </div>
      {showSource ? (
        <pre
          style={{
            margin: 0,
            padding: "0.75rem 1rem",
            background: "hsl(var(--bg-muted))",
            color: "hsl(var(--fg))",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 12,
            lineHeight: 1.55,
            overflow: "auto",
            maxHeight: height + 40,
            whiteSpace: "pre",
          }}
        >
          <code>{source}</code>
        </pre>
      ) : (
        <iframe
          srcDoc={doc}
          sandbox="allow-forms"
          referrerPolicy="no-referrer"
          loading="lazy"
          title={t("block.liveCss.title")}
          style={{
            width: "100%",
            height,
            border: 0,
            background: "white",
            display: "block",
          }}
        />
      )}
    </div>
  );
}

void Maximize2; // keep the icon import alive for future fullscreen support
