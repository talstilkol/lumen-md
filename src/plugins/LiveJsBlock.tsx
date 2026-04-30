/**
 * Live JavaScript preview — type JS in the fence body and inspect
 * stdout-like console output from a dedicated worker context.
 */

import { useEffect, useRef, useState } from "react";
import { Code2, Play, Trash2 } from "lucide-react";
import { t } from "../i18n";

type LogLevel = "log" | "info" | "warn" | "error";

interface LogEntry {
  id: number;
  level: LogLevel;
  parts: string[];
  ts: number;
}

interface Props {
  source: string;
  meta?: string;
}

interface WorkerPayload {
  type: "run";
  source: string;
  runId: number;
  timeoutMs: number;
}

interface WorkerLog {
  type: "log" | "done" | "error";
  runId: number;
  level?: LogLevel;
  parts?: string[];
}

const WORKER_SOURCE = `
const toParts = function(args) {
  const list = Array.prototype.slice.call(args);
  return list.map(function(a) {
    if (a === undefined) return "undefined";
    if (a === null) return "null";
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a, null, 2);
    } catch (e) {
      return String(a);
    }
  });
};

const emit = function(level, args, runId) {
  try {
    self.postMessage({
      type: "log",
      runId: runId,
      level: level,
      parts: toParts(args),
    });
  } catch (e) {}
};

self.onmessage = function(event) {
  const payload = event.data || {};
  if (payload.type !== "run") return;

  const runId = payload.runId || 0;
  const source = String(payload.source || "");
  const timeoutMs = Number(payload.timeoutMs || 0);
  const timer = timeoutMs > 0 ? setTimeout(function() {
    emit("error", ["Execution timed out"], runId);
    self.postMessage({ type: "done", runId: runId });
    self.close();
  }, timeoutMs) : null;

  self.onerror = function(msg, filename, lineno, colno) {
    emit("error", [String(msg) + " (" + (filename || "inline") + ":" + (lineno || 0) + ":" + (colno || 0) + ")"], runId);
  };
  self.onunhandledrejection = function(e) {
    var reason = e && e.reason ? e.reason : e;
    emit("error", ["Unhandled rejection: " + (reason && reason.message ? reason.message : String(reason))], runId);
  };

  try {
    const safeConsole = {
      log: function() { emit("log", arguments, runId); },
      info: function() { emit("info", arguments, runId); },
      warn: function() { emit("warn", arguments, runId); },
      error: function() { emit("error", arguments, runId); },
    };
    const runner = new Function(
      "console",
      "(async function() {\\n" + source + "\\n})();"
    );
    Promise.resolve().then(function() { return runner(safeConsole); }).then(
      function() {
        if (timer) clearTimeout(timer);
        self.postMessage({ type: "done", runId: runId });
      },
      function(err) {
        if (timer) clearTimeout(timer);
        emit("error", [err && err.stack ? err.stack : String(err)], runId);
        self.postMessage({ type: "done", runId: runId });
      },
    );
  } catch (err) {
    if (timer) clearTimeout(timer);
    emit("error", [err && err.stack ? err.stack : String(err)], runId);
    self.postMessage({ type: "done", runId: runId });
  }
};
`;

const LEVEL_COLOR: Record<LogLevel, string> = {
  log: "hsl(var(--fg))",
  info: "hsl(220 14% 65%)",
  warn: "hsl(40 90% 60%)",
  error: "hsl(0 80% 65%)",
};

const DEFAULT_TIMEOUT_MS = 8000;
const WORKER_URL_KEY = "__lumenWorkerBlobUrl";
type RunState = "running" | "success" | "error" | "timeout";

function makeWorker(): Worker | null {
  try {
    const blob = new Blob([WORKER_SOURCE], { type: "application/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url, { type: "classic" });
    (worker as Worker & { [WORKER_URL_KEY]?: string })[WORKER_URL_KEY] = url;
    return worker;
  } catch {
    return null;
  }
}

export default function LiveJsBlock({ source, meta }: Props) {
  const heightMatch = meta?.match(/height=(\d+)/);
  const height = heightMatch ? Number(heightMatch[1]) : 240;
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showSource, setShowSource] = useState(false);
  const [runId, setRunId] = useState(0);
  const [runState, setRunState] = useState<RunState>("running");
  const [workerErr, setWorkerErr] = useState<string | null>(null);
  const idCounter = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    setLogs([]);
    setWorkerErr(null);
    setRunState("running");
    let hadError = false;

    const currentRun = runId;
    const worker = makeWorker();
    if (!worker) {
      setWorkerErr("Live JS worker unavailable in this browser.");
      return;
    }
    workerRef.current = worker;

    const onMsg = (e: MessageEvent) => {
      const msg = e.data as WorkerLog;
      if (!msg || typeof msg.runId !== "number" || msg.runId !== currentRun) return;
      if (msg.type === "done") {
        setRunState(hadError ? "error" : "success");
        return;
      }
      if (!msg.level || !msg.parts) return;
      if (msg.level === "error") {
        hadError = true;
        setRunState("error");
      }
    setLogs((prev) =>
      [...prev, {
        id: ++idCounter.current,
        level: msg.level,
        parts: msg.parts,
        ts: Date.now(),
      }].slice(-200),
    );
  };

    worker.addEventListener("message", onMsg);
    worker.postMessage({
      type: "run",
      runId: currentRun,
      source,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    } as WorkerPayload);

    const timer = setTimeout(() => {
      worker.terminate();
      setWorkerErr("Live JS execution timed out.");
      hadError = true;
      setRunState("timeout");
    }, DEFAULT_TIMEOUT_MS + 200);

    return () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMsg);
      worker.terminate();
      const workerUrl = (worker as Worker & { [WORKER_URL_KEY]?: string })[WORKER_URL_KEY];
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerRef.current = null;
    };
  }, [source, runId]);

  function reRun() {
    setLogs([]);
    setRunId((n) => n + 1);
  }

  const stateLabel = {
    running: "Running…",
    success: "Completed",
    error: "Runtime error",
    timeout: "Timed out",
  }[runState];

  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span>{t("block.liveJs.title")}</span>
        <div className="chart-block-tabs">
        <button
            type="button"
            className="chart-block-tab"
            onClick={reRun}
            title={t("block.liveJs.run")}
            aria-label={t("block.liveJs.run")}
          >
            <Play size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
            {t("block.liveJs.run")}
          </button>
          <button
            type="button"
            className="chart-block-tab"
            onClick={() => setLogs([])}
            title={t("block.liveJs.clear")}
            aria-label={t("block.liveJs.clear")}
          >
            <Trash2 size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
            {t("block.liveJs.clear")}
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
      <div
        style={{
          marginTop: 0,
          marginBottom: 6,
          fontSize: 11,
          color: runState === "error" || runState === "timeout" ? "hsl(0 80% 65%)" : "hsl(var(--fg-muted))",
          textAlign: "right",
        }}
      >
        JS run: {stateLabel}
      </div>
      <div
        role="log"
        aria-live="polite"
        style={{
          maxHeight: height,
          overflowY: "auto",
          background: "hsl(var(--bg-subtle))",
          padding: "8px 12px",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        {workerErr ? (
          <div style={{ color: LEVEL_COLOR.error }}>{workerErr}</div>
        ) : logs.length === 0 ? (
          <span style={{ color: "hsl(var(--fg-muted))", fontStyle: "italic" }}>
            {t("block.liveJs.noOutput")}
          </span>
        ) : (
          logs.map((l) => (
            <div key={l.id} style={{ color: LEVEL_COLOR[l.level], whiteSpace: "pre-wrap" }}>
              <span style={{ opacity: 0.6 }}>[{l.level}]</span> {l.parts.join(" ")}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
