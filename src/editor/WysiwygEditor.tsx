import { useEffect, useRef } from "react";
import {
  Editor as MilkdownEditor,
  rootCtx,
  defaultValueCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { clipboard } from "@milkdown/plugin-clipboard";
import { math } from "@milkdown/plugin-math";
import { slashFactory, SlashProvider } from "@milkdown/plugin-slash";
import { tooltipFactory, TooltipProvider } from "@milkdown/plugin-tooltip";
import { setBlockType, toggleMark, wrapIn } from "@milkdown/prose/commands";
import type { EditorView } from "@milkdown/prose/view";
import { wrapInList } from "prosemirror-schema-list";
import "katex/dist/katex.css";
import { chat, chatStream, AiError } from "../ai/llm";
import { PROMPTS } from "../ai/prompts";
import { showAiToast } from "../ui/AiToast";
import { openAiPrompt } from "../ui/AiInlinePrompt";
import { log } from "../lib/logger";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

const slash = slashFactory("wysiwyg-slash");
const tooltip = tooltipFactory("wysiwyg-tooltip");

interface SlashItem {
  label: string;
  icon: string;
  run: (view: EditorView) => void;
}

function buildSlashItems(): SlashItem[] {
  const heading = (level: number): SlashItem => ({
    label: `Heading ${level}`,
    icon: `H${level}`,
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
      run: (v) => {
        const node = v.state.schema.nodes.bullet_list;
        if (node) wrapInList(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Ordered list",
      icon: "1.",
      run: (v) => {
        const node = v.state.schema.nodes.ordered_list;
        if (node) wrapInList(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Blockquote",
      icon: "❝",
      run: (v) => {
        const node = v.state.schema.nodes.blockquote;
        if (node) wrapIn(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Code block",
      icon: "</>",
      run: (v) => {
        const node = v.state.schema.nodes.code_block;
        if (node) setBlockType(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Math block",
      icon: "∑",
      run: (v) => {
        const node = v.state.schema.nodes.math_block;
        if (node) setBlockType(node)(v.state, v.dispatch);
      },
    },
    {
      label: "Divider",
      icon: "—",
      run: (v) => {
        const hr = v.state.schema.nodes.hr;
        if (!hr) return;
        v.dispatch(v.state.tr.replaceSelectionWith(hr.create()));
      },
    },
    {
      label: "AI Ghostwriter",
      icon: "✨",
      run: async (v) => {
        const promptStr = await openAiPrompt("What do you want the AI to write about?");
        if (!promptStr) return;

        const placeholder = "🤖 Thinking...";
        const { state } = v;
        const insertPos = state.selection.from;
        v.dispatch(state.tr.insertText(placeholder, insertPos));

        try {
          let accumulated = "";
          const stream = chatStream(
            [
              { role: "system", content: PROMPTS.ghostwriter },
              { role: "user", content: promptStr },
            ],
          );
          // Remove placeholder before streaming
          const removeTr = v.state.tr;
          removeTr.delete(insertPos, insertPos + placeholder.length);
          v.dispatch(removeTr);

          for await (const chunk of stream) {
            accumulated += chunk;
            // Replace accumulated text at insert position
            const tr = v.state.tr;
            const endOfText = insertPos + accumulated.length - chunk.length;
            tr.insertText(chunk, endOfText);
            v.dispatch(tr);
          }
        } catch (e) {
          log.error("WYSIWYG AI stream failed", e);
          // If placeholder is still there, replace it
          const docText = v.state.doc.textBetween(insertPos, Math.min(insertPos + placeholder.length, v.state.doc.content.size));
          if (docText === placeholder) {
            const errTr = v.state.tr;
            errTr.delete(insertPos, insertPos + placeholder.length);
            errTr.insertText(e instanceof AiError && e.code === "NO_KEY" ? "⚠️ Configure AI Key (⌘K)" : "❌ AI Failed", insertPos);
            v.dispatch(errTr);
          }
          showAiToast(
            e instanceof AiError && e.code === "NO_KEY"
              ? "Please configure your AI Key (⌘K → AI Settings)"
              : "AI Ghostwriter failed — check console for details",
            "error",
          );
        }
      },
    },
  ];
}

function buildSlashMenu(getView: () => EditorView | null): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "milkdown-slash-menu";
  el.dataset.show = "false";

  for (const item of buildSlashItems()) {
    const row = document.createElement("div");
    row.className = "milkdown-slash-item";
    row.tabIndex = -1;

    const icon = document.createElement("span");
    icon.className = "slash-icon";
    icon.textContent = item.icon;

    const label = document.createElement("span");
    label.textContent = item.label;

    row.appendChild(icon);
    row.appendChild(label);

    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const view = getView();
      if (!view) return;
      // Strip the `/` trigger before running the command.
      const { state } = view;
      const { $from } = state.selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\u00A0");
      const slashIdx = text.lastIndexOf("/");
      if (slashIdx >= 0) {
        const from = $from.start() + slashIdx;
        view.dispatch(state.tr.delete(from, $from.pos));
      }
      item.run(view);
      view.focus();
    });
    el.appendChild(row);
  }
  return el;
}

interface TooltipBtn {
  label: string;
  title: string;
  run: (v: EditorView) => void;
}

function buildTooltip(getView: () => EditorView | null): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "milkdown-tooltip";
  el.dataset.show = "false";

  const buttons: TooltipBtn[] = [
    {
      label: "B",
      title: "Bold",
      run: (v) => {
        const m = v.state.schema.marks.strong;
        if (m) toggleMark(m)(v.state, v.dispatch);
      },
    },
    {
      label: "I",
      title: "Italic",
      run: (v) => {
        const m = v.state.schema.marks.emphasis;
        if (m) toggleMark(m)(v.state, v.dispatch);
      },
    },
    {
      label: "S",
      title: "Strikethrough",
      run: (v) => {
        const m = v.state.schema.marks.strike_through;
        if (m) toggleMark(m)(v.state, v.dispatch);
      },
    },
    {
      label: "</>",
      title: "Inline code",
      run: (v) => {
        const m = v.state.schema.marks.code_inline ?? v.state.schema.marks.inlineCode;
        if (m) toggleMark(m)(v.state, v.dispatch);
      },
    },
    {
      label: "🔗",
      title: "Link",
      run: async (v) => {
        const m = v.state.schema.marks.link;
        if (!m) return;
        const url = await openAiPrompt("URL:");
        if (!url) return;
        toggleMark(m, { href: url })(v.state, v.dispatch);
      },
    },
    {
      label: "✨",
      title: "AI Rewrite",
      run: async (v) => {
        const { state, dispatch } = v;
        const { from, to } = state.selection;
        if (from === to) return;
        
        const selectedText = state.doc.textBetween(from, to, "\n");
        const instructions = await openAiPrompt("How should the AI rewrite this? (e.g. 'Make it professional', 'Translate to Spanish')");
        if (!instructions) return;
        
        try {
          const rewritten = await chat(
            [
              { role: "system", content: PROMPTS.rewrite },
              { role: "user", content: `Instruction: ${instructions}\n\nText: ${selectedText}` },
            ],
          );
          dispatch(state.tr.replaceWith(from, to, state.schema.text(rewritten)));
        } catch (e) {
          log.error("WYSIWYG AI rewrite failed", e);
          showAiToast("AI Rewrite failed", "error");
        }
      },
    },
  ];

  for (const btn of buttons) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = btn.title;
    b.textContent = btn.label;
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const view = getView();
      if (!view) return;
      btn.run(view);
      view.focus();
    });
    el.appendChild(b);
  }
  return el;
}

/**
 * WYSIWYG editor powered by Milkdown (ProseMirror under the hood).
 * Recreates on external `value` changes (file open). Internal edits stream out
 * via the listener plugin.
 *
 * Includes math (KaTeX), a `/` slash command menu, and a selection tooltip
 * for inline formatting.
 */
export default function WysiwygEditor({ value, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MilkdownEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedRef = useRef<string>(value);

  // DOM elements + view ref reused across editor recreations.
  const slashElRef = useRef<HTMLDivElement | null>(null);
  const tooltipElRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const getView = () => viewRef.current;

  const mountedRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;
    // Always build on first mount; skip subsequent if content unchanged
    if (mountedRef.current && lastEmittedRef.current === value) return;
    mountedRef.current = true;
    let cancelled = false;
    const host = hostRef.current;

    (async () => {
      if (editorRef.current) {
        try {
          await editorRef.current.destroy(true);
        } catch {
          /* ignore */
        }
        editorRef.current = null;
      }
      if (cancelled || !host) return;
      host.innerHTML = "";

      // Create floating menu DOMs lazily and reuse them.
      if (!slashElRef.current) slashElRef.current = buildSlashMenu(getView);
      if (!tooltipElRef.current) tooltipElRef.current = buildTooltip(getView);

      const editor = await MilkdownEditor.make()
        .config((ctx) => {
          ctx.set(rootCtx, host);
          ctx.set(defaultValueCtx, value);
          ctx.get(listenerCtx).markdownUpdated((_, md) => {
            lastEmittedRef.current = md;
            onChangeRef.current(md);
          });

          ctx.set(slash.key, {
            view: (view: EditorView) => {
              viewRef.current = view;
              const provider = new SlashProvider({
                content: slashElRef.current!,
                debounce: 50,
                trigger: "/",
              });
              provider.update(view);
              return {
                update: (v: EditorView, prev) => {
                  viewRef.current = v;
                  provider.update(v, prev);
                },
                destroy: () => {
                  provider.destroy();
                  if (viewRef.current === view) viewRef.current = null;
                },
              };
            },
          });

          ctx.set(tooltip.key, {
            view: (view: EditorView) => {
              viewRef.current = view;
              const provider = new TooltipProvider({
                content: tooltipElRef.current!,
                debounce: 50,
              });
              provider.update(view);
              return {
                update: (v: EditorView, prev) => {
                  viewRef.current = v;
                  provider.update(v, prev);
                },
                destroy: () => {
                  provider.destroy();
                  if (viewRef.current === view) viewRef.current = null;
                },
              };
            },
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        .use(clipboard)
        .use(math)
        .use(slash)
        .use(tooltip)
        .create();

      if (cancelled) {
        await editor.destroy(true);
        return;
      }
      editorRef.current = editor;
      lastEmittedRef.current = value;
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Final teardown.
  useEffect(() => {
    return () => {
      const ed = editorRef.current;
      if (ed) {
        ed.destroy(true).catch(() => {});
        editorRef.current = null;
      }
      slashElRef.current?.remove();
      slashElRef.current = null;
      tooltipElRef.current?.remove();
      tooltipElRef.current = null;
      viewRef.current = null;
    };
  }, []);

  return (
    <div className="wysiwyg-host h-full overflow-y-auto">
      <div ref={hostRef} className="prose-lumen wysiwyg-root" />
    </div>
  );
}
