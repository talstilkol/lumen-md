/**
 * Live SQL preview — runs the fence body against an in-memory SQLite database
 * via sql.js (SQLite compiled to WebAssembly), lazy-loaded from a CDN on first
 * run. Each block gets a fresh database, so a CREATE/INSERT/SELECT script runs
 * end-to-end. Results render as tables.
 */
import { useRef, useState } from "react";
import { Database, Play, Code2 } from "lucide-react";

interface Props {
  source: string;
  meta?: string;
}

const SQLJS_VERSION = "1.12.0";
const SQLJS_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/`;

interface QueryResult {
  columns: string[];
  values: unknown[][];
}
interface SqlDatabase {
  exec: (sql: string) => QueryResult[];
  close: () => void;
}
interface SqlJsStatic {
  Database: new () => SqlDatabase;
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load sql.js"));
    document.head.appendChild(s);
  });
}

async function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      await loadScript(SQLJS_BASE + "sql-wasm.js");
      const init = (globalThis as unknown as {
        initSqlJs?: (cfg: { locateFile: (f: string) => string }) => Promise<SqlJsStatic>;
      }).initSqlJs;
      if (!init) throw new Error("sql.js global not found after load");
      return init({ locateFile: (f) => SQLJS_BASE + f });
    })().catch((err) => {
      sqlPromise = null;
      throw err;
    });
  }
  return sqlPromise;
}

type RunState = "idle" | "loading" | "running" | "success" | "error";

export default function LiveSqlBlock({ source, meta }: Props) {
  const heightMatch = meta?.match(/height=(\d+)/);
  const height = heightMatch ? Number(heightMatch[1]) : 280;
  const [results, setResults] = useState<QueryResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<RunState>("idle");
  const [showSource, setShowSource] = useState(false);
  const runSeq = useRef(0);

  async function run() {
    const seq = ++runSeq.current;
    setResults([]);
    setError(null);
    setState("loading");
    let SQL: SqlJsStatic;
    try {
      SQL = await getSql();
    } catch (err) {
      if (seq !== runSeq.current) return;
      setState("error");
      setError(`Failed to load the SQLite runtime (sql.js). ${(err as Error).message}`);
      return;
    }
    if (seq !== runSeq.current) return;
    setState("running");
    const db = new SQL.Database();
    try {
      const res = db.exec(source);
      if (seq !== runSeq.current) return;
      setResults(res);
      setState("success");
    } catch (err) {
      if (seq !== runSeq.current) return;
      setError(String((err as Error).message ?? err));
      setState("error");
    } finally {
      db.close();
    }
  }

  const stateLabel = {
    idle: "Not run",
    loading: "Loading SQLite…",
    running: "Running…",
    success: results.length ? "Completed" : "OK (no rows)",
    error: "Error",
  }[state];

  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span>
          <Database size={12} style={{ display: "inline", marginInlineEnd: 4 }} />
          Live SQL
        </span>
        <div className="chart-block-tabs">
          <button
            type="button"
            className="chart-block-tab"
            onClick={run}
            disabled={state === "loading" || state === "running"}
            title="Run SQL"
            aria-label="Run SQL"
          >
            <Play size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
            Run
          </button>
          <button
            type="button"
            className={`chart-block-tab ${showSource ? "active" : ""}`}
            onClick={() => setShowSource((v) => !v)}
            aria-pressed={showSource}
            title="Toggle source"
          >
            <Code2 size={11} style={{ display: "inline", marginInlineEnd: 4 }} />
            Source
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
          marginBottom: 6,
          fontSize: 11,
          color: state === "error" ? "hsl(0 80% 65%)" : "hsl(var(--fg-muted))",
          textAlign: "right",
        }}
      >
        SQL: {stateLabel}
      </div>
      <div style={{ maxHeight: height, overflow: "auto", padding: "0 4px 8px" }}>
        {error ? (
          <div style={{ color: "hsl(0 80% 65%)", fontFamily: "monospace", fontSize: 12 }}>
            {error}
          </div>
        ) : results.length === 0 ? (
          <span style={{ color: "hsl(var(--fg-muted))", fontStyle: "italic", fontSize: 12 }}>
            {state === "success" ? "Statement executed (no result set)." : "Click Run to execute this SQL block."}
          </span>
        ) : (
          results.map((r, i) => (
            <table key={i} className="data-table" style={{ marginBottom: 12, fontSize: 13 }}>
              <thead>
                <tr>
                  {r.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.values.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{cell === null ? "NULL" : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))
        )}
      </div>
    </div>
  );
}
