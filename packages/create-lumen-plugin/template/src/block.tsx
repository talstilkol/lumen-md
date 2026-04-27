/**
 * Example custom block — renders the source of a `__PLUGIN_NAME__` code
 * fence as a styled card. Replace this with whatever you want — Lumen
 * mounts your component with `{ source, meta }` props and React 18.
 */

import type { LumenBlockProps } from "./types";

export function ExampleBlock({ source, meta }: LumenBlockProps) {
  return (
    <div
      style={{
        padding: "12px 16px",
        margin: "12px 0",
        borderRadius: 10,
        border: "1px solid hsl(var(--border, 232 22% 22%))",
        background: "hsl(var(--bg-subtle, 232 27% 11%))",
        fontFamily: "Inter, ui-sans-serif, system-ui",
      }}
    >
      <div style={{ fontSize: 11, color: "hsl(var(--fg-muted, 220 14% 68%))", marginBottom: 6 }}>
        __PLUGIN_TITLE__ {meta ? `· ${meta}` : ""}
      </div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "JetBrains Mono, monospace" }}>
        {source}
      </pre>
    </div>
  );
}
