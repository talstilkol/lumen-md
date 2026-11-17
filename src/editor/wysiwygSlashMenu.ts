/**
 * The WYSIWYG editor's `/` slash menu (W10.E29): its items, the fuzzy
 * filter and the menu element. Moved verbatim out of WysiwygEditor.tsx for
 * the 800-line limit (W6.25).
 */
import { setBlockType, wrapIn } from "@milkdown/prose/commands";
import type { EditorView } from "@milkdown/prose/view";
import { wrapInList } from "prosemirror-schema-list";
import { showAiToast } from "../ui/AiToast";
import { openAiPrompt } from "../ui/AiInlinePrompt";
import { log } from "../lib/logger";
import { t } from "../i18n";
import { explainError } from "../lib/userError";
import { AiError } from "../ai/llm";
import { markAiInsert } from "./wysiwygAiAuthorship";
import { matchesAnyFilter } from "../text/filterMatch";

export interface SlashItem {
  label: string;
  icon: string;
  /** Search keywords beyond label — typing any of these still surfaces it. */
  keywords?: string[];
  /** Category header used by the renderer for grouping. */
  group: "Headings" | "Lists" | "Blocks" | "Media" | "Data" | "AI";
  run: (view: EditorView) => void;
}

/**
 * Insert a verbatim markdown source block at the current selection. Used
 * for blocks that aren't part of the Milkdown schema (charts, csv-tables,
 * mermaid). The text is inserted as a code-block node with the matching
 * `language` so the round-trip to source preserves it.
 */
export function insertCodeFence(v: EditorView, lang: string, body: string): void {
  const node = v.state.schema.nodes.code_block;
  if (!node) return;
  const tr = v.state.tr.replaceSelectionWith(
    node.create({ language: lang }, v.state.schema.text(body)),
  );
  // ai-authorship: a template the slash menu itself holds (its callers pass fixed text); no model text
  v.dispatch(tr);
}

export function buildSlashItems(): SlashItem[] {
  const heading = (level: number): SlashItem => ({
    label: `Heading ${level}`,
    icon: `H${level}`,
    keywords: ["title", `h${level}`],
    group: "Headings",
    run: (v) => {
      const node = v.state.schema.nodes.heading;
      if (node) setBlockType(node, { level })(v.state, v.dispatch);
    },
  });
  return [
    heading(1),
    heading(2),
    heading(3),
    heading(4),
    {
      label: "Bullet list",
      icon: "•",
      keywords: ["ul", "unordered"],
      group: "Lists",
      run: (v) => {
        const node = v.state.schema.nodes.bullet_list;
        if (node) wrapInList(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Ordered list",
      icon: "1.",
      keywords: ["ol", "numbered"],
      group: "Lists",
      run: (v) => {
        const node = v.state.schema.nodes.ordered_list;
        if (node) wrapInList(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Task list",
      icon: "☐",
      keywords: ["todo", "checkbox", "checklist"],
      group: "Lists",
      run: (v) => {
        const node = v.state.schema.nodes.bullet_list;
        if (!node) return;
        const before = v.state.doc;
        wrapInList(node)(v.state, v.dispatch);
        // Wrapping can be refused (suggesting mode): then add no marker.
        if (v.state.doc === before) return;
        // Inject a leading checkbox marker so the round-trip to markdown
        // produces `- [ ] ...` on the new line.
        const tr = v.state.tr.insertText("[ ] ", v.state.selection.from);
        // ai-authorship: a task-list marker the user picked from the slash menu; no model text
        v.dispatch(tr);
      },
    },
    {
      label: "Blockquote",
      icon: "❝",
      keywords: ["quote", "cite"],
      group: "Blocks",
      run: (v) => {
        const node = v.state.schema.nodes.blockquote;
        if (node) wrapIn(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Code block",
      icon: "</>",
      keywords: ["code", "snippet", "fence"],
      group: "Blocks",
      run: (v) => {
        const node = v.state.schema.nodes.code_block;
        if (node) setBlockType(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Math block",
      icon: "∑",
      keywords: ["latex", "tex", "equation", "formula"],
      group: "Blocks",
      run: (v) => {
        const node = v.state.schema.nodes.math_block;
        if (node) setBlockType(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Callout",
      icon: "💡",
      keywords: ["note", "tip", "warning", "info", "admonition"],
      group: "Blocks",
      run: (v) => {
        const tr = v.state.tr.insertText(
          ":::note\nWrite your callout here.\n:::\n",
          v.state.selection.from,
        );
        // ai-authorship: a callout template the user picked from the slash menu; no model text
        v.dispatch(tr);
      },
    },
    {
      label: "Columns",
      icon: "▥",
      keywords: ["columns", "two-column", "side-by-side", "layout"],
      group: "Blocks",
      run: (v) => {
        const tr = v.state.tr.insertText(
          ":::columns{cols=2}\nLeft column.\n:::\nRight column.\n:::\n",
          v.state.selection.from,
        );
        // ai-authorship: a columns template the user picked from the slash menu; no model text
        v.dispatch(tr);
      },
    },
    {
      label: "Divider",
      icon: "—",
      keywords: ["hr", "rule", "separator"],
      group: "Blocks",
      run: (v) => {
        const hr = v.state.schema.nodes.hr;
        if (!hr) return;
        // ai-authorship: a horizontal rule the user picked from the slash menu; no model text
        v.dispatch(v.state.tr.replaceSelectionWith(hr.create()));
      },
    },
    {
      label: "Table",
      icon: "▦",
      keywords: ["grid", "rows", "cols"],
      group: "Data",
      run: (v) => {
        const tr = v.state.tr.insertText(
          "| Col 1 | Col 2 | Col 3 |\n| :--- | :---: | ---: |\n| L | C | R |\n| Data | Data | Data |\n",
          v.state.selection.from,
        );
        // ai-authorship: a table template the user picked from the slash menu; no model text
        v.dispatch(tr);
      },
    },
    {
      label: "CSV table",
      icon: "📊",
      keywords: ["data", "csv", "spreadsheet"],
      group: "Data",
      run: (v) =>
        insertCodeFence(
          v,
          "csv",
          "month,revenue\nJan,4200\nFeb,4800\nMar,5100",
        ),
    },
    {
      label: "Chart",
      icon: "📈",
      keywords: ["echarts", "plot", "graph", "visualisation"],
      group: "Data",
      run: (v) =>
        insertCodeFence(
          v,
          "chart",
          'title:\n  text: My chart\nxAxis:\n  type: category\n  data: [Jan, Feb, Mar]\nyAxis:\n  type: value\nseries:\n  - name: Sales\n    type: bar\n    data: [12, 19, 8]',
        ),
    },
    {
      label: "Mermaid diagram",
      icon: "🧩",
      keywords: ["flowchart", "sequence", "graph", "diagram"],
      group: "Data",
      run: (v) =>
        insertCodeFence(
          v,
          "mermaid",
          "flowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Path A]\n  B -->|No| D[Path B]",
        ),
    },
    {
      label: "Image",
      icon: "🖼",
      keywords: ["picture", "img", "photo"],
      group: "Media",
      run: (v) => {
        const tr = v.state.tr.insertText(
          "![alt text](https://example.com/image.png)",
          v.state.selection.from,
        );
        // ai-authorship: an image template the user picked from the slash menu; no model text
        v.dispatch(tr);
      },
    },
    {
      label: "Embed (YouTube / Tweet / Map…)",
      icon: "🌐",
      keywords: ["video", "youtube", "twitter", "x", "vimeo", "embed", "map"],
      group: "Media",
      run: (v) =>
        insertCodeFence(v, "embed", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    },
    {
      label: "AI Ghostwriter",
      icon: "✨",
      keywords: ["ai", "write", "complete", "draft"],
      group: "AI",
      run: async (v) => {
        const promptStr = await openAiPrompt("What do you want the AI to write about?");
        if (!promptStr) return;

        const placeholder = "🤖 Thinking...";
        const { state } = v;
        const insertPos = state.selection.from;
        // ai-authorship: the app's own "Thinking" placeholder, removed before the model's text goes in
        v.dispatch(state.tr.insertText(placeholder, insertPos));

        const { aiOperation, isAbort } = await import("../ai/aiAbort");
        const op = aiOperation(); // Esc / "AI: Cancel" stops the ghostwriter mid-stream
        try {
          let accumulated = "";
          const { streamAgent } = await import("../agents/runtime");
          const { writerAgent } = await import("../agents/defs");
          const stream = streamAgent(writerAgent, { text: promptStr }, { ownPrompt: true, signal: op.signal });
          // Remove placeholder before streaming
          const removeTr = v.state.tr;
          removeTr.delete(insertPos, insertPos + placeholder.length);
          // ai-authorship: removes the placeholder; inserts nothing
          v.dispatch(removeTr);

          for await (const chunk of stream) {
            if (op.signal.aborted) break; // why: nothing more goes into the note after a cancel
            accumulated += chunk;
            // Replace accumulated text at insert position
            const tr = v.state.tr;
            const endOfText = insertPos + accumulated.length - chunk.length;
            tr.insertText(chunk, endOfText);
            // 5.9 / W10.E37: the agent's text, marked as it goes in.
            v.dispatch(markAiInsert(tr));
          }
        } catch (e) {
          const docText = v.state.doc.textBetween(insertPos, Math.min(insertPos + placeholder.length, v.state.doc.content.size));
          if (isAbort(e)) {
            // Cancelled before the first chunk: take the placeholder out and stop quietly.
            // ai-authorship: removes the placeholder after a cancel; inserts nothing
            if (docText === placeholder) v.dispatch(v.state.tr.delete(insertPos, insertPos + placeholder.length));
            return;
          }
          log.error("WYSIWYG AI stream failed", e);
          // 5.6.4: an agent failure opens the suggestions panel (the placeholder is still replaced below).
          void import("../agents/suggestions").then((m) => m.reportAgentFailure(e, "wysiwyg.aiWrite"));
          // If placeholder is still there, replace it
          if (docText === placeholder) {
            const errTr = v.state.tr;
            errTr.delete(insertPos, insertPos + placeholder.length);
            errTr.insertText(e instanceof AiError && e.code === "NO_KEY" ? "⚠️ Configure AI Key (⌘K)" : "❌ AI Failed", insertPos);
            // ai-authorship: the app's own error text in place of the placeholder; no model text
            v.dispatch(errTr);
          }
          showAiToast(
            e instanceof AiError && e.code === "NO_KEY"
              ? t("toast.pleaseConfigureYourAiKey")
              : t("ai.ghostwriter.failed", { error: explainError(e) }),
            "error",
          );
        } finally {
          op.end();
        }
      },
    },
  ];
}

/**
 * Filter slash items by a free-text query (matches label + keywords).
 * Empty query returns the full list.
 */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  if (!query.trim()) return items;
  return items.filter((it) => matchesAnyFilter([it.label, ...(it.keywords ?? [])], query));
}

/**
 * Render the slash menu as DOM. Supports:
 *   - category headers (Headings / Lists / Blocks / Data / Media / AI)
 *   - keyboard navigation via ↑/↓/Enter (driven by the EditorView's keymap)
 *   - live filter via `setQuery(q)` exposed on the returned element
 *   - selection highlight via `data-selected="true"` attribute
 *
 * The function returns the root `<div>` extended with helpers so the
 * Milkdown SlashProvider can drive it.
 */
export interface SlashMenuRoot extends HTMLDivElement {
  setQuery(q: string): void;
  moveSelection(delta: number): void;
  runSelected(): void;
}

export function buildSlashMenu(getView: () => EditorView | null): SlashMenuRoot {
  const el = document.createElement("div") as SlashMenuRoot;
  el.className = "milkdown-slash-menu";
  el.dataset.show = "false";

  const all = buildSlashItems();
  let visible: SlashItem[] = all;
  let selectedIndex = 0;

  function commit(item: SlashItem) {
    const view = getView();
    if (!view) return;
    // Strip the `/` trigger plus any query the user typed after it.
    const { state } = view;
    const { $from } = state.selection;
    const text = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      "\u00A0",
    );
    const slashIdx = text.lastIndexOf("/");
    if (slashIdx >= 0) {
      const from = $from.start() + slashIdx;
      // ai-authorship: deletes the typed slash command; inserts nothing
      view.dispatch(state.tr.delete(from, $from.pos));
    }
    item.run(view);
    view.focus();
  }

  function render(): void {
    el.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "milkdown-slash-empty";
      empty.textContent = "No matches";
      empty.style.padding = "10px 14px";
      empty.style.fontSize = "11.5px";
      empty.style.color = "hsl(var(--fg-muted))";
      el.appendChild(empty);
      return;
    }
    let prevGroup: string | null = null;
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i];
      if (item.group !== prevGroup) {
        const head = document.createElement("div");
        head.className = "milkdown-slash-group";
        head.textContent = item.group;
        head.style.padding = "6px 12px 2px";
        head.style.fontSize = "10px";
        head.style.fontWeight = "700";
        head.style.letterSpacing = "0.05em";
        head.style.textTransform = "uppercase";
        head.style.color = "hsl(var(--fg-muted))";
        el.appendChild(head);
        prevGroup = item.group;
      }
      const row = document.createElement("div");
      row.className = "milkdown-slash-item";
      row.tabIndex = -1;
      row.dataset.index = String(i);
      if (i === selectedIndex) row.dataset.selected = "true";

      const icon = document.createElement("span");
      icon.className = "slash-icon";
      icon.textContent = item.icon;

      const label = document.createElement("span");
      label.className = "slash-label";
      label.textContent = item.label;

      row.appendChild(icon);
      row.appendChild(label);
      row.addEventListener("mouseenter", () => {
        selectedIndex = i;
        for (const r of el.querySelectorAll<HTMLElement>(".milkdown-slash-item")) {
          delete r.dataset.selected;
        }
        row.dataset.selected = "true";
      });
      // pointerdown (plan 10.2.1): a tap picks the item like a click. Its
      // preventDefault also suppresses the compatibility mousedown, so the
      // editor keeps focus; mousedown is still cancelled for older engines.
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        commit(item);
      });
      row.addEventListener("mousedown", (e) => e.preventDefault());
      el.appendChild(row);
    }
  }

  el.setQuery = (q: string) => {
    visible = filterSlashItems(all, q);
    selectedIndex = 0;
    render();
  };
  el.moveSelection = (delta: number) => {
    if (visible.length === 0) return;
    selectedIndex =
      (selectedIndex + delta + visible.length) % visible.length;
    render();
    const sel = el.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    );
    sel?.scrollIntoView({ block: "nearest" });
  };
  el.runSelected = () => {
    const it = visible[selectedIndex];
    if (it) commit(it);
  };

  render();
  return el;
}
