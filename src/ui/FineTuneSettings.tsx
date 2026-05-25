/**
 * Fine-tune Settings panel (F3 / γ.5 UI surface).
 *
 * Drives the `useFineTunedModel` + `fineTunedModelId` flags in
 * `useStore`. Shows:
 *   - Whether a fine-tuned model is persisted
 *   - "Train on my style" CTA → triggers the F3 pipeline
 *   - Live job status with poll + progress
 *   - Toggle to route AI requests through the fine-tuned model
 *   - Clear-data action that deletes the local model id (the
 *     OpenAI side stays — user must delete it from their dashboard
 *     for full removal; this is documented in the dialog)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, ShieldOff, Brain } from "lucide-react";
import { useAppStore } from "../store/useStore";
import { showAiToast } from "./AiToast";
import { startFineTune, getFineTuneJob, type FineTuneJob } from "../ai/fineTune";
import { uiConfirm } from "./PromptDialog";
import { log } from "../lib/logger";
import { t } from "../i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 30_000;

export function FineTuneSettings({ open, onClose }: Props) {
  const useFineTunedModel = useAppStore((s) => s.useFineTunedModel);
  const fineTunedModelId = useAppStore((s) => s.fineTunedModelId);
  const toggleFineTunedModel = useAppStore((s) => s.toggleFineTunedModel);
  const setFineTunedModelId = useAppStore((s) => s.setFineTunedModelId);
  const aiKey = useAppStore((s) => s.aiKey);

  const [job, setJob] = useState<FineTuneJob | null>(null);
  const [running, setRunning] = useState(false);
  const [chunks, setChunks] = useState(0);
  const [tokens, setTokens] = useState(0);
  const pollTimer = useRef<number | null>(null);

  // Poll the job until it leaves "queued" / "running".
  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const next = await getFineTuneJob(jobId);
        setJob(next);
        if (next.status === "succeeded" && next.fineTunedModel) {
          setFineTunedModelId(next.fineTunedModel);
          showAiToast(
            t("fineTune.toast.succeeded", { model: next.fineTunedModel }),
            "success",
          );
          if (pollTimer.current != null) {
            window.clearInterval(pollTimer.current);
            pollTimer.current = null;
          }
        } else if (next.status === "failed" || next.status === "cancelled") {
          showAiToast(
            t("fineTune.toast.failed", { status: next.status }),
            "error",
          );
          if (pollTimer.current != null) {
            window.clearInterval(pollTimer.current);
            pollTimer.current = null;
          }
        }
      } catch (e) {
        log.warn("fine-tune poll failed", e);
      }
    },
    [setFineTunedModelId],
  );

  useEffect(() => {
    if (!job || job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return;
    }
    pollTimer.current = window.setInterval(() => {
      void pollJob(job.id);
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current != null) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [job, pollJob]);

  const handleTrain = useCallback(async () => {
    if (!aiKey) {
      showAiToast(t("fineTune.needKey"), "error");
      return;
    }
    const ok = await uiConfirm({
      message: t("fineTune.confirm"),
    });
    if (!ok) return;
    setRunning(true);
    try {
      const res = await startFineTune();
      setChunks(res.chunks);
      setTokens(res.estimatedTokens);
      setJob(res);
      showAiToast(
        t("fineTune.toast.queued", { chunks: String(res.chunks), tokens: String(res.estimatedTokens) }),
        "info",
      );
    } catch (e) {
      log.error("fine-tune start failed", e);
      showAiToast(t("fineTune.toast.error", { error: (e as Error).message }), "error");
    } finally {
      setRunning(false);
    }
  }, [aiKey]);

  const handleForget = useCallback(async () => {
    const ok = await uiConfirm({ message: t("fineTune.forgetConfirm") });
    if (!ok) return;
    setFineTunedModelId(null);
    if (useFineTunedModel) toggleFineTunedModel();
    showAiToast(t("fineTune.toast.forgot"), "info");
  }, [setFineTunedModelId, toggleFineTunedModel, useFineTunedModel]);

  if (!open) return null;

  return (
    <div
      className="cmd-palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("fineTune.title")}
    >
      <div
        className="cmd-palette"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 540, padding: 0, display: "flex", flexDirection: "column" }}
      >
        <header style={{ padding: "14px 18px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <Brain size={18} style={{ color: "hsl(var(--accent))" }} />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("fineTune.title")}</h2>
        </header>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16, fontSize: 13, lineHeight: 1.5 }}>
          <p style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>{t("fineTune.intro")}</p>

          {/* Current state */}
          <section
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              background: "hsl(var(--bg-subtle))",
              border: "1px solid hsl(var(--border))",
            }}
          >
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--fg-muted))", marginBottom: 6 }}>
              {t("fineTune.status")}
            </div>
            {fineTunedModelId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{t("fineTune.modelReady")}</div>
                  <code
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: "hsl(var(--fg-muted))",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fineTunedModelId}
                  </code>
                </div>
              </div>
            ) : job ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                <div>
                  <div style={{ fontWeight: 600 }}>{t("fineTune.training", { status: job.status })}</div>
                  {chunks > 0 && (
                    <div style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
                      {t("fineTune.statsLine", { chunks: String(chunks), tokens: String(tokens) })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ color: "hsl(var(--fg-muted))" }}>{t("fineTune.notTrained")}</div>
            )}
          </section>

          {/* Toggle */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: fineTunedModelId ? "pointer" : "not-allowed",
              opacity: fineTunedModelId ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              checked={useFineTunedModel}
              disabled={!fineTunedModelId}
              onChange={() => toggleFineTunedModel()}
            />
            <span>
              <strong>{t("fineTune.useToggle")}</strong>
              <br />
              <span style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
                {t("fineTune.useToggleHint")}
              </span>
            </span>
          </label>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleTrain}
              disabled={running || (job !== null && job.status !== "succeeded" && job.status !== "failed" && job.status !== "cancelled")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: "1px solid hsl(var(--accent))",
                background: "hsl(var(--accent) / 0.10)",
                color: "hsl(var(--accent))",
                cursor: running ? "wait" : "pointer",
              }}
            >
              {running ? (
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
              ) : (
                <Sparkles size={12} />
              )}
              {fineTunedModelId ? t("fineTune.retrain") : t("fineTune.train")}
            </button>
            {fineTunedModelId && (
              <button
                type="button"
                onClick={handleForget}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid hsl(0 60% 60% / 0.5)",
                  background: "transparent",
                  color: "hsl(0 70% 65%)",
                  cursor: "pointer",
                }}
              >
                <ShieldOff size={12} />
                {t("fineTune.forget")}
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid hsl(var(--border))",
                background: "transparent",
                color: "hsl(var(--fg))",
                cursor: "pointer",
              }}
            >
              {t("fineTune.close")}
            </button>
          </div>

          {/* Privacy note */}
          <p style={{ margin: 0, fontSize: 11, color: "hsl(var(--fg-muted))", lineHeight: 1.6 }}>
            {t("fineTune.privacy")}
          </p>
        </div>
      </div>
    </div>
  );
}
