/**
 * Live R block (```live-r / ```r-live) — runs the fence body in R compiled
 * to WebAssembly (webR). Nothing loads until the user clicks Run; the
 * runtime (~45 MB, cached afterwards) is self-hosted under /webr/ — no CDN,
 * CSP-safe, works offline. Printed output, messages, warnings, errors and
 * base-graphics plots are shown. Packages from CRAN can't be installed
 * (the app only connects to its own origin), but base R and the
 * recommended packages bundled with webR are available.
 */
import { useEffect, useRef, useState } from "react";
import { Code2, Play, Square, Trash2 } from "lucide-react";
import { t } from "../i18n";
import { resetWebR, runR, type ROutputLine } from "./r/rRuntime";

interface Props {
  source: string;
  meta?: string;
}

type RunState = "idle" | "loading" | "running" | "success" | "error" | "timeout";

const DEFAULT_TIMEOUT_MS = 30_000;
/** Downloading (~45 MB) and booting R on a slow connection. */
const LOAD_TIMEOUT_MS = 180_000;

function parseTimeout(meta?: string): number {
  const m = meta?.match(/timeout=(\d+)/);
  const v = m ? Number(m[1]) : DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(v, 1000), 300_000);
}

function Plot({ image }: { image: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d")?.drawImage(image, 0, 0);
  }, [image]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={t("block.liveR.plot")}
      style={{ maxWidth: "100%", height: "auto", background: "white", borderRadius: 4 }}
    />
  );
}

export default function LiveRBlock({ source, meta }: Props) {
  const heightMatch = meta?.match(/height=(\d+)/);
  const height = heightMatch ? Number(heightMatch[1]) : 280;
  const timeoutMs = parseTimeout(meta);
  const [lines, setLines] = useState<ROutputLine[]>([]);
  const [images, setImages] = useState<ImageBitmap[]>([]);
  const [state, setState] = useState<RunState>("idle");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [showSource, setShowSource] = useState(false);
  const runSeq = useRef(0);
  // True while this block's run holds the shared webR instance (it has left
  // the queue). Only then may Stop / unmount reset the runtime; a run that
  // is still queued is just skipped, so another block's run survives.
  const executing = useRef(false);

  /** Drop the current run; reset webR only if that run is executing. */
  const abandon = () => {
    runSeq.current++;
    if (executing.current) {
      executing.current = false;
      void resetWebR();
    }
  };

  useEffect(() => abandon, []);

  async function run() {
    const runId = ++runSeq.current;
    setLines([]);
    setImages([]);
    setElapsed(null);
    setState("loading");
    const started = performance.now();
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const after = (ms: number) =>
      new Promise<"timeout">((resolve) => {
        timers.push(setTimeout(() => resolve("timeout"), ms));
      });
    try {
      // The first Run downloads and boots the runtime: that gets its own,
      // longer budget, so the block's `timeout=` is all execution time.
      const { getWebR } = await import("./r/rRuntime");
      const ready = await Promise.race([getWebR().then(() => "ready" as const), after(LOAD_TIMEOUT_MS)]);
      if (runId !== runSeq.current) return;
      if (ready === "timeout") {
        // A boot that hangs (never rejects) would stay cached: drop it so the
        // next Run starts a fresh instance.
        void resetWebR();
        throw new Error(t("block.liveR.loadTimeout"));
      }
      setState("running");
      // The execution timer starts when the run does (other R blocks may
      // be ahead of it in the queue).
      let startTimer: () => void = () => {};
      const timedOut = new Promise<"timeout">((resolve) => {
        startTimer = () => timers.push(setTimeout(() => resolve("timeout"), timeoutMs));
      });
      const out = await Promise.race([
        runR(source, undefined, {
          onStart: () => {
            executing.current = true;
            startTimer();
          },
          isCancelled: () => runId !== runSeq.current,
        }).finally(() => {
          if (runId === runSeq.current) executing.current = false;
        }),
        timedOut,
      ]);
      if (runId !== runSeq.current || out === null) return;
      if (out === "timeout") {
        // R can't be interrupted over the PostMessage channel: drop the
        // runtime; the next Run boots a fresh one.
        executing.current = false;
        await resetWebR();
        setLines([{ kind: "err", text: t("block.liveR.timedOut", { ms: timeoutMs }) }]);
        setState("timeout");
        return;
      }
      setLines(out.lines);
      setImages(out.images);
      setElapsed(Math.round(performance.now() - started));
      setState(out.lines.some((l) => l.kind === "err") ? "error" : "success");
    } catch (err) {
      if (runId !== runSeq.current) return;
      const detail = err instanceof Error ? err.message || err.name : String(err);
      setLines([{ kind: "err", text: `${t("block.liveR.loadFailed")} ${detail}`.trim() }]);
      setState("error");
    } finally {
      for (const h of timers) clearTimeout(h);
    }
  }

  function cancel() {
    abandon();
    setLines((prev) => [...prev, { kind: "err", text: t("block.liveR.stopped") }]);
    setState("error");
  }

  const busy = state === "loading" || state === "running";
  const stateLabel = {
    idle: t("block.liveR.state.idle"),
    loading: t("block.liveR.state.loading"),
    running: t("block.liveR.state.running"),
    success: t("block.liveR.state.success"),
    error: t("block.liveR.state.error"),
    timeout: t("block.liveR.state.timeout"),
  }[state];
  const failed = state === "error" || state === "timeout";
  const color = (k: ROutputLine["kind"]) =>
    k === "err" ? "hsl(0 80% 65%)" : k === "warn" ? "hsl(40 90% 55%)" : k === "msg" ? "hsl(220 14% 65%)" : "hsl(var(--fg))";

  return (
    <div className="chart-block" data-testid="live-r" data-state={state}>
      <div className="chart-block-header">
        <span>{t("block.liveR.title")}</span>
        <div className="chart-block-tabs">
          {busy ? (
            <button type="button" className="chart-block-tab" onClick={cancel} title={t("block.liveR.stop")} aria-label={t("block.liveR.stop")}>
              <Square size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
              {t("block.liveR.stop")}
            </button>
          ) : (
            <button type="button" className="chart-block-tab" onClick={() => void run()} title={t("block.liveR.run")} aria-label={t("block.liveR.run")}>
              <Play size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
              {t("block.liveR.run")}
            </button>
          )}
          <button
            type="button"
            className="chart-block-tab"
            onClick={() => {
              setLines([]);
              setImages([]);
            }}
            title={t("block.liveR.clear")}
            aria-label={t("block.liveR.clear")}
          >
            <Trash2 size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
            {t("block.liveR.clear")}
          </button>
          <button
            type="button"
            className={`chart-block-tab ${showSource ? "active" : ""}`}
            onClick={() => setShowSource((v) => !v)}
            aria-pressed={showSource}
            title={t("block.htmlPreview.toggleSource")}
          >
            <Code2 size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
            {t("block.htmlPreview.source")}
          </button>
        </div>
      </div>
      {showSource && (
        <pre
          dir="ltr"
          style={{
            margin: 0,
            padding: "0.75rem 1rem",
            background: "hsl(var(--bg-muted))",
            color: "hsl(var(--fg))",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 12,
            lineHeight: 1.55,
            overflow: "auto",
            maxHeight: 200,
            whiteSpace: "pre",
          }}
        >
          <code>{source}</code>
        </pre>
      )}
      <div style={{ marginBottom: 6, fontSize: 11, color: failed ? "hsl(0 80% 65%)" : "hsl(var(--fg-muted))", textAlign: "end" }}>
        R: {stateLabel}
        {elapsed !== null && ` · ${elapsed} ms`}
      </div>
      <div
        role="log"
        aria-live="polite"
        dir="ltr"
        style={{
          maxHeight: height,
          overflowY: "auto",
          background: "hsl(var(--bg-subtle))",
          padding: "8px 12px",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          display: "grid",
          gap: 8,
        }}
      >
        {lines.length === 0 && images.length === 0 ? (
          <span style={{ color: "hsl(var(--fg-muted))", fontStyle: "italic" }}>
            {state === "idle" ? t("block.liveR.prompt") : state === "loading" ? t("block.liveR.loading") : t("block.liveJs.noOutput")}
          </span>
        ) : (
          <>
            {lines.length > 0 && (
              <div>
                {lines.map((l, i) => (
                  <div key={i} style={{ color: color(l.kind) }}>
                    {l.text.replace(/\n$/, "")}
                  </div>
                ))}
              </div>
            )}
            {images.map((img, i) => (
              <Plot key={i} image={img} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
