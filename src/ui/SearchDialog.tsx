import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Search, FileText, Sparkles, Loader2, FileCode2 } from "lucide-react";
import { t } from "../i18n";
import { searchWorkspace, type SearchHit } from "../storage/workspaceIndex";
import { isOPFSAvailable, readWorkspaceFile } from "../storage/workspace";
import { chat, AiError } from "../ai/llm";
import type { ChatMessage } from "../ai/llm";
import { PROMPTS } from "../ai/prompts";
import { renderMarkdown } from "../renderer/pipeline";
import { showAiToast } from "../ui/AiToast";
import { semanticSearch, type RagResult } from "../ai/embeddings";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the workspace path + content when a file is selected. */
  onOpenFile: (path: string, content: string) => void;
}

export function SearchDialog({ open, onClose, onOpenFile }: Props) {
  const [mode, setMode] = useState<"search" | "ai">("search");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiRendered, setAiRendered] = useState<ReactElement | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSources, setAiSources] = useState<RagResult[]>([]);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      setQuery("");
      setMode("search");
      setAiAnswer(null);
      setAiRendered(null);
      setAiSources([]);
      setConversation([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      const prev = previousFocusRef.current as HTMLElement | null;
      prev?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      searchWorkspace(query, { limit: 40 })
        .then((h) => {
          if (cancelled) return;
          setHits(h);
          setActive(0);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-search-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  async function openHit(hit: SearchHit) {
    onClose();
    try {
      const content = await readWorkspaceFile(hit.path);
      onOpenFile(hit.path, content);
    } catch {
      /* file gone */
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "search") {
        const hit = hits[active];
        if (hit) void openHit(hit);
      } else if (mode === "ai" && query.trim()) {
        void askAi();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  async function askAi() {
    setAiLoading(true);
    setAiAnswer("Searching workspace...");
    setAiSources([]);
    
    try {
      // Semantic search for relevant context
      const results = await semanticSearch(query, { topK: 8, maxContentChars: 6000 });
      setAiSources(results);

      // Build context from semantic results
      const contextStr = results.length > 0
        ? results.map((r, i) => `---\n📄 [${i + 1}] ${r.path}\n${r.content}`).join("\n")
        : "No relevant files found in workspace.";

      setAiAnswer("Thinking...");

      // Build multi-turn messages
      const messages: ChatMessage[] = [
        { role: "system", content: PROMPTS.ragAssistant + "\n\nWhen referencing information from context files, cite them as [1], [2], etc." },
        ...conversation,
        { role: "user", content: `Context Files:\n${contextStr}\n\nQuestion: ${query}` },
      ];

      const answer = await chat(messages);
      setAiAnswer(answer);

      // Save to conversation history
      setConversation((prev) => [
        ...prev,
        { role: "user" as const, content: query },
        { role: "assistant" as const, content: answer },
      ]);

      const isDark = () => document.documentElement.classList.contains("dark");
      const rendered = await renderMarkdown(answer, isDark);
      setAiRendered(rendered);
    } catch (e) {
      if (e instanceof AiError && e.code === "NO_KEY") {
        setAiAnswer("⚠️ Please configure your AI Key (⌘K → AI Settings).");
        showAiToast("Please configure your AI Key (⌘K → AI Settings)", "error");
      } else {
        console.error(e);
        setAiAnswer("Failed to reach AI API.");
        showAiToast("AI workspace search failed", "error");
      }
    } finally {
      setAiLoading(false);
    }
  }

  const empty = useMemo(() => !loading && hits.length === 0, [loading, hits]);

  if (!open) return null;

  return (
    <div className="cmd-palette-backdrop" onClick={onClose} role="dialog" aria-modal>
      <div ref={dialogRef} className="cmd-palette" style={{ minHeight: "350px", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", borderBottom: "1px solid hsl(var(--border))", padding: "0 10px" }}>
          <button className={`chart-block-tab ${mode === "search" ? "active" : ""}`} style={{ fontSize: 13, background: "transparent" }} onClick={() => setMode("search")}>
             Search
          </button>
          <button className={`chart-block-tab ${mode === "ai" ? "active" : ""}`} style={{ fontSize: 13, background: "transparent" }} onClick={() => setMode("ai")}>
             <Sparkles size={11} style={{display:"inline", marginRight:4}}/> Ask Workspace
          </button>
        </div>
        <div className="cmd-palette-search">
          <Search size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={
              isOPFSAvailable() ? t("search.placeholder") : t("search.unavailable")
            }
            aria-label={t("search.placeholder")}
            spellCheck={false}
            disabled={!isOPFSAvailable()}
          />
        </div>
        <div className="cmd-palette-list" ref={listRef}>
          {empty && (
            <div className="cmd-palette-empty">
              {query ? t("search.noMatches") : t("search.empty")}
            </div>
          )}
          {hits.map((hit, i) => (
            <div
              key={hit.path}
              data-search-index={i}
              className={`cmd-palette-item ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => void openHit(hit)}
              style={{ alignItems: "flex-start" }}
              title={hit.path}
            >
              <FileText size={14} style={{ opacity: 0.7, marginTop: 1, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cmd-palette-label" style={{ fontWeight: 500 }}>
                  {hit.name}
                  {hit.path !== hit.name && (
                    <span style={{ color: "hsl(var(--fg-muted))", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                      {hit.path}
                    </span>
                  )}
                </div>
                {hit.snippet && (
                  <div
                    style={{
                      color: "hsl(var(--fg-muted))",
                      fontSize: 11.5,
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {renderSnippet(hit)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        {mode === "ai" && (
          <div style={{ flex: 1, padding: "12px 16px", overflowY: "auto", fontSize: 13, color: "hsl(var(--fg))", borderTop: "1px solid hsl(var(--border))", background: "hsl(var(--bg-subtle))", display: "flex", flexDirection: "column", gap: 10 }}>
            {aiLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "hsl(var(--accent))" }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                <span>{aiAnswer === "Searching workspace..." ? "Searching workspace..." : "Thinking..."}</span>
              </div>
            ) : aiRendered ? (
              <>
                <div className="prose-lumen" style={{ padding: 0, fontSize: 13, lineHeight: 1.6, maxWidth: "none" }}>
                  {aiRendered}
                </div>
                {aiSources.length > 0 && (
                  <div style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 8, marginTop: 4 }}>
                    <div style={{ fontSize: 11, color: "hsl(var(--fg-muted))", marginBottom: 4, fontWeight: 600 }}>Sources</div>
                    {aiSources.map((s, i) => (
                      <div
                        key={s.path}
                        onClick={() => { onClose(); onOpenFile(s.path, s.content); }}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 11, color: "hsl(var(--accent))", cursor: "pointer" }}
                        title={`Relevance: ${(s.score * 100).toFixed(0)}%`}
                      >
                        <FileCode2 size={11} />
                        <span>[{i + 1}] {s.path}</span>
                        <span style={{ color: "hsl(var(--fg-muted))", marginLeft: "auto" }}>{(s.score * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {conversation.length > 0 && (
                  <div style={{ fontSize: 11, color: "hsl(var(--fg-muted))", fontStyle: "italic" }}>
                    {conversation.length / 2} turn{conversation.length > 2 ? "s" : ""} in this conversation
                  </div>
                )}
              </>
            ) : aiAnswer ? (
              <div style={{ whiteSpace: "pre-wrap" }}>{aiAnswer}</div>
            ) : (
              <div style={{ opacity: 0.5, fontStyle: "italic" }}>Type a question and press Enter to ask the AI workspace.</div>
            )}
          </div>
        )}

        <div className="cmd-palette-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> {t("palette.navigate")}</span>
          <span><kbd>↵</kbd> {t("palette.select")}</span>
          <span><kbd>Esc</kbd> {t("palette.close")}</span>
        </div>
      </div>
    </div>
  );
}

function renderSnippet(hit: SearchHit): React.ReactNode {
  if (!hit.snippet) return null;
  if (!hit.match) return hit.snippet;
  const { start, end } = hit.match;
  return (
    <>
      {hit.snippet.slice(0, start)}
      <mark
        style={{
          background: "hsl(var(--accent) / 0.25)",
          color: "hsl(var(--fg))",
          padding: 0,
        }}
      >
        {hit.snippet.slice(start, end)}
      </mark>
      {hit.snippet.slice(end)}
    </>
  );
}
