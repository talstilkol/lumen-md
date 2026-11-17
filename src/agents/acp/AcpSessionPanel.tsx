/**
 * Plan W11.I23 — the live panel of a hosted ACP agent (Claude Code, Codex,
 * OpenCode): what the agent says, thinks and runs while it works, its plan,
 * and the two things the user can do mid-run — stop it, or open the review
 * panel where every file it wrote waits for approval.
 *
 * The agent's text is untrusted and shown as plain text (transcript.ts), each
 * entry `dir="auto"` so a Hebrew reply reads right to left. The log is a
 * polite live region; it scrolls and is reachable by Tab (tabIndex 0).
 * Opening it moves focus to Stop; closing it gives focus back to where it was.
 * Loaded on demand with the "Ask an external agent…" command.
 */
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t } from "../../i18n";
import { applyUpdate, emptyTranscript, type Transcript } from "./transcript";
import "./AcpSessionPanel.css";

export type AcpRunState = "running" | "stopping" | "done" | "failed";

export interface AcpPanelModel {
  agent: string;
  prompt: string;
  transcript: Transcript;
  state: AcpRunState;
  /** The stop reason or the error, once the run is over. */
  detail?: string;
}

export interface AcpPanelProps {
  model: AcpPanelModel;
  onStop: () => void;
  onReview: () => void;
  onClose: () => void;
}

const TOOL_MARK: Record<string, string> = { pending: "○", in_progress: "◐", completed: "●", failed: "✕" };

export function AcpSessionPanel({ model, onStop, onReview, onClose }: AcpPanelProps) {
  const stop = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const over = model.state === "done" || model.state === "failed";
  useEffect(() => {
    stop.current?.focus();
  }, []);
  useEffect(() => {
    // Focus never drops to <body>: when Stop goes away, Close takes it.
    if (over && (document.activeElement === document.body || !document.activeElement?.isConnected)) close.current?.focus();
  }, [over]);
  useEffect(() => {
    const el = log.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [model.transcript]);
  const status =
    model.state === "running"
      ? t("ai.acp.panel.running", { agent: model.agent })
      : model.state === "stopping"
        ? t("ai.acp.panel.stopping")
        : model.state === "done"
          ? t("ai.acp.panel.done", { reason: model.detail ?? "end_turn" })
          : t("ai.acp.panel.failed", { error: model.detail ?? "" });
  return (
    <section
      className="acp-panel"
      role="region"
      aria-labelledby="acp-panel-title"
      data-testid="acp-panel"
      data-state={model.state}
      onKeyDown={(e) => {
        if (e.key === "Escape" && over) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="acp-panel-head">
        <h2 id="acp-panel-title">{t("ai.acp.panel.title", { agent: model.agent })}</h2>
        <p className="acp-panel-prompt" dir="auto">
          {model.prompt}
        </p>
      </header>
      <div ref={log} className="acp-panel-log" role="log" aria-live="polite" aria-label={t("ai.acp.panel.log")} tabIndex={0} data-testid="acp-panel-log">
        {model.transcript.entries.length === 0 && <p className="acp-muted">{t("ai.acp.panel.empty")}</p>}
        {model.transcript.entries.map((e, i) =>
          e.kind === "message" ? (
            <p key={i} className="acp-msg" dir="auto">
              {e.text}
            </p>
          ) : e.kind === "thought" ? (
            <p key={i} className="acp-thought" dir="auto">
              <span className="acp-label">{t("ai.acp.panel.thinking")}</span> {e.text}
            </p>
          ) : e.kind === "tool" ? (
            <p key={i} className={`acp-tool acp-tool-${e.status}`} data-testid="acp-tool">
              <span aria-hidden="true">{TOOL_MARK[e.status]}</span> <span dir="auto">{e.title}</span> <span className="acp-muted">({t(`ai.acp.panel.status.${e.status}`)})</span>
            </p>
          ) : (
            <div key={i} className="acp-plan">
              <span className="acp-label">{t("ai.acp.panel.plan")}</span>
              <ol>
                {e.items.map((it, j) => (
                  <li key={j} dir="auto" data-status={it.status}>
                    {it.text}
                  </li>
                ))}
              </ol>
            </div>
          ),
        )}
      </div>
      <p className="acp-panel-status" role="status" data-testid="acp-panel-status">
        {status}
      </p>
      <div className="acp-panel-actions">
        <button type="button" className="acp-btn" onClick={onReview} data-testid="acp-review">
          {t("ai.acp.panel.review")}
        </button>
        {over ? (
          <button ref={close} type="button" className="acp-btn" onClick={onClose} data-testid="acp-close">
            {t("ai.acp.panel.close")}
          </button>
        ) : (
          <button ref={stop} type="button" className="acp-btn acp-btn-stop" onClick={onStop} disabled={model.state === "stopping"} data-testid="acp-stop">
            {t("ai.acp.panel.stop")}
          </button>
        )}
      </div>
    </section>
  );
}

/* ─── Mounting it over the app ─────────────────────────────────────── */

export interface AcpPanelHandle {
  update(update: Record<string, unknown>): void;
  set(patch: Partial<Omit<AcpPanelModel, "transcript">>): void;
  model(): AcpPanelModel;
  close(): void;
}

/** Opens the panel; the run's callbacks feed it. One panel per run. */
export function openAcpPanel(init: { agent: string; prompt: string; onStop: () => void; onReview?: () => void }): AcpPanelHandle {
  const opener = document.activeElement as HTMLElement | null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let model: AcpPanelModel = { agent: init.agent, prompt: init.prompt, transcript: emptyTranscript(), state: "running" };
  let closed = false;
  const review = init.onReview ?? (() => window.dispatchEvent(new Event("lumen-open-agent-review")));
  const render = () => {
    if (!closed) root.render(<AcpSessionPanel model={model} onStop={init.onStop} onReview={review} onClose={handle.close} />);
  };
  const handle: AcpPanelHandle = {
    update(u) {
      model = { ...model, transcript: applyUpdate(model.transcript, u) };
      render();
    },
    set(patch) {
      model = { ...model, ...patch };
      render();
    },
    model: () => model,
    close() {
      if (closed) return;
      closed = true;
      root.unmount();
      host.remove();
      if (opener?.isConnected) opener.focus();
    },
  };
  render();
  return handle;
}
