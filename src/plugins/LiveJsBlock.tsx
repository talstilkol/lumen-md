/**
 * Live JavaScript preview — type JS in the fence body, see captured
 * `console.log/info/warn/error` output beneath. Runs inside the same
 * sandboxed iframe as `htmlpreview`, so the script has no access to
 * the parent's storage / DOM / cookies.
 *
 * Communication: the iframe overrides `console.*` to forward each call
 * over `postMessage`. The host listens for those messages and prints a
 * scrolling list of entries.
 *
 * Errors (sync + unhandled rejection) are caught in the iframe via
 * `window.onerror` / `unhandledrejection` and forwarded the same way.
 *
 * Use `meta` to set the height: ```` ```live-js height=320 ````.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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

const LEVEL_COLOR: Record<LogLevel, string> = {
  log: "hsl(var(--fg))",
  info: "hsl(220 14% 65%)",
  warn: "hsl(40 90% 60%)",
  error: "hsl(0 80% 65%)",
};

function buildSrcDoc(source: string): string {
  // We escape the user code with a JSON.stringify trick — by embedding
  // it as a JSON string and `eval`-ing inside, we never need to do
  // tag-encoding gymnastics on `</script>` etc. The eval runs in the
  // sandboxed origin only.
  const escapedSource = JSON.stringify(source);
  return `<!doctype html><html><head><meta charset="utf-8" /></head><body><script>
(function() {
  var post = function(level, args) {
    try {
      var parts = Array.prototype.map.call(args, function(a) {
        if (a === undefined) return "undefined";
        if (a === null) return "null";
        if (typeof a === "string") return a;
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
      });
      parent.postMessage({ __lumenJs: true, level: level, parts: parts }, "*");
    } catch (e) {
      try { parent.postMessage({ __lumenJs: true, level: "error", parts: [String(e)] }, "*"); } catch {}
    }
  };
  ["log","info","warn","error"].forEach(function(k){
    var orig = console[k];
    console[k] = function() {
      post(k, arguments);
      try { orig.apply(console, arguments); } catch {}
    };
  });
  window.addEventListener("error", function(e) {
    post("error", [e.message + " (" + (e.filename || "inline") + ":" + e.lineno + ")"]);
  });
  window.addEventListener("unhandledrejection", function(e) {
    post("error", ["Unhandled rejection: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason))]);
  });
  try {
    // Async wrapper so the user's code can use \`await\`.
    (async function() { eval(${escapedSource}); })();
  } catch (e) {
    post("error", [(e && e.stack) ? e.stack : String(e)]);
  }
})();
</script></body></html>`;
}

export default function LiveJsBlock({ source, meta }: Props) {
  const heightMatch = meta?.match(/height=(\d+)/);
  const height = heightMatch ? Number(heightMatch[1]) : 240;
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showSource, setShowSource] = useState(false);
  const [runId, setRunId] = useState(0);
  const idCounter = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Listen for log messages from the iframe — only ours, by the magic
  // `__lumenJs` flag, to prevent embeds in other panes from polluting.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const msg = e.data as { __lumenJs?: boolean; level?: LogLevel; parts?: string[] };
      if (!msg?.__lumenJs || !msg.level) return;
      setLogs((prev) =>
        prev
          .concat({
            id: ++idCounter.current,
            level: msg.level!,
            parts: msg.parts ?? [],
            ts: Date.now(),
          })
          .slice(-200), // cap at 200 entries to keep the DOM tiny
      );
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const doc = useMemo(() => buildSrcDoc(source), [source, runId]);

  function reRun() {
    setLogs([]);
    setRunId((n) => n + 1);
  }

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
      {/* Hidden iframe that runs the user code. Width 0 — we only care
          about its console output, which is forwarded via postMessage. */}
      <iframe
        ref={iframeRef}
        key={runId}
        srcDoc={doc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={t("block.liveJs.title")}
        style={{
          width: "100%",
          height: 0,
          border: 0,
          display: "block",
        }}
      />
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
        {logs.length === 0 ? (
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
