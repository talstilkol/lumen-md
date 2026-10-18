/**
 * Hover preview in the source editor (plan 4.6): CodeMirror's hoverTooltip
 * over `[[Note]]` / `![[Note]]` shows the note's first 20 lines rendered.
 * The renderer (renderer/hoverPreview) loads on the first hover.
 */

import { hoverTooltip } from "@codemirror/view";

const LINK = /!?\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;

export const wikiHover = hoverTooltip(
  async (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const off = pos - line.from;
    for (const m of line.text.matchAll(LINK)) {
      const at = m.index ?? 0;
      if (off < at || off > at + m[0].length) continue;
      const target = m[1].trim();
      if (!target || target.startsWith("#")) return null;
      const { renderPreview, mountPreview } = await import("../renderer/hoverPreview");
      const el = await renderPreview(target).catch(() => null);
      if (!el) return null;
      return {
        pos: line.from + at,
        end: line.from + at + m[0].length,
        create() {
          const dom = document.createElement("div");
          dom.className = "lumen-hover-card lumen-hover-card-cm";
          dom.dataset.testid = "hover-preview-editor";
          const unmount = mountPreview(dom, el);
          return { dom, destroy: unmount };
        },
      };
    }
    return null;
  },
  { hoverTime: 150 },
);
