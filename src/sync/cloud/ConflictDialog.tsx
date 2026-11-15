/**
 * Conflict-resolution dialog — opens when cloud sync finds that both
 * local and remote sides changed since the last sync.
 *
 * Renders the 3-way diff (`threeWayDiff`) in three columns — mine, the
 * common base, theirs (W12.S3; in RTL "mine" is on the right) — with
 * radio toggles for each `conflict` hunk, and a result editor under them
 * that starts from the picks and can be edited by hand. Auto-merge hunks
 * render read-only so the user can see what they're getting. Alt+↓/↑ or
 * F7/Shift+F7 move between conflicts.
 *
 * Returns one of:
 *   • `{ kind: "merged", content }` — apply the merged content
 *   • `{ kind: "local"  }`           — take local wholesale
 *   • `{ kind: "remote" }`           — take remote wholesale
 *   • `null`                         — cancelled
 */

import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyMerge, attachBase, threeWayDiff, type DiffHunk } from "./diff";
import { t } from "../../i18n";
import { HelpButton } from "../../ui/HelpButton";
import "./conflictDialogStrings";
import { Modal } from "../../ui/Modal";

export type ConflictChoice =
  | { kind: "merged"; content: string }
  | { kind: "local" }
  | { kind: "remote" }
  | null;

/**
 * Wording of the dialog. Cloud sync uses the defaults; a change made outside
 * Lumen (plan 4.4) passes its own, translated labels.
 */
export interface ConflictLabels {
  title: string;
  description: string;
  local: string;
  remote: string;
  takeLocal: string;
  takeRemote: string;
  merge: string;
  cancel: string;
}

interface Props {
  path: string;
  base: string;
  local: string;
  remote: string;
  labels?: Partial<ConflictLabels>;
  /** Hunks computed by the caller's own merge (git uses diff3); default: `threeWayDiff`. */
  hunks?: DiffHunk[];
  onResolve: (choice: ConflictChoice) => void;
}

function ConflictDialogImpl({ path, base, local, remote, labels, hunks: given, onResolve }: Props) {
  const L: ConflictLabels = {
    title: t("sync.conflict.title", { path }),
    description: t("sync.conflict.body"),
    local: t("sync.conflict.local"),
    remote: t("sync.conflict.remote"),
    takeLocal: t("sync.conflict.takeLocal"),
    takeRemote: t("sync.conflict.takeRemote"),
    merge: t("sync.conflict.apply"),
    cancel: t("dialog.cancel"),
    ...labels,
  };
  const hunks = useMemo<DiffHunk[]>(
    () => attachBase(given ?? threeWayDiff(base, local, remote)),
    [given, base, local, remote],
  );
  const conflictHunkIdxs = hunks
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.op === "conflict")
    .map(({ i }) => i);
  const [picks, setPicks] = useState<Array<"local" | "remote" | "both">>(
    () => conflictHunkIdxs.map(() => "local"),
  );

  function setPick(idx: number, val: "local" | "remote" | "both") {
    const next = [...picks];
    next[idx] = val;
    setPicks(next);
  }

  // W12.S3: a result editor under the three columns. It follows the picks
  // until the user types in it; from then on the typed text is what is
  // applied (and "Reset to picks" brings the picks back).
  const picked = useMemo(() => applyMerge(hunks, picks), [hunks, picks]);
  const [edited, setEdited] = useState<string | null>(null);
  const result = edited ?? picked;
  const hunkRefs = useRef<Array<HTMLElement | null>>([]);
  const [current, setCurrent] = useState(0);
  const total = conflictHunkIdxs.length;
  const go = (delta: number) => {
    if (!total) return;
    const next = (current + delta + total) % total;
    setCurrent(next);
    hunkRefs.current[next]?.focus();
  };
  // Alt+↓ / Alt+↑ (and F7 / Shift+F7, as in VS Code's merge editor) move between conflicts.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.altKey && e.key === "ArrowDown") || (e.key === "F7" && !e.shiftKey)) go(1);
    else if ((e.altKey && e.key === "ArrowUp") || (e.key === "F7" && e.shiftKey)) go(-1);
    else return;
    e.preventDefault();
  };
  const cols = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 } as const;

  return (
    <Modal onClose={() => onResolve(null)}
      aria-labelledby="conflict-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        onKeyDown={onKeyDown}
        style={{
          background: "hsl(var(--bg))",
          color: "hsl(var(--fg))",
          border: "1px solid hsl(var(--border-strong))",
          borderRadius: 12,
          width: "min(1200px, 100vw - 32px)",
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid hsl(var(--border))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div id="conflict-title" style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>
              {L.title}
            </div>
            {total > 0 && (
              <>
                <button type="button" onClick={() => go(-1)} style={btnSecondary} aria-keyshortcuts="Alt+ArrowUp Shift+F7">
                  {t("sync.conflict.prev")}
                </button>
                <button type="button" onClick={() => go(1)} style={btnSecondary} aria-keyshortcuts="Alt+ArrowDown F7">
                  {t("sync.conflict.next")}
                </button>
              </>
            )}
            <HelpButton topic="editor/tools#sync-conflicts" />
          </div>
          <div style={{ fontSize: 12, color: "hsl(var(--fg-muted))", marginTop: 2 }}>
            {L.description}
          </div>
        </header>

        <div style={{ overflow: "auto", flex: 1, fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 12 }}>
          {/* Column order follows the text direction: in RTL "mine" is on the right. */}
          <div aria-hidden="true" style={{ ...cols, position: "sticky", top: 0, background: "hsl(var(--bg))", borderBottom: "1px solid hsl(var(--border))", fontWeight: 600, fontFamily: "inherit" }}>
            <div style={{ padding: "4px 12px" }}>{L.local}</div>
            <div style={{ padding: "4px 12px" }}>{t("sync.conflict.base")}</div>
            <div style={{ padding: "4px 12px" }}>{L.remote}</div>
          </div>
          {hunks.map((h, i) => {
            const conflictPickIdx = conflictHunkIdxs.indexOf(i);
            const isConflict = h.op === "conflict";
            return (
              <div
                key={i}
                data-testid={isConflict ? "conflict-hunk" : undefined}
                ref={isConflict ? (el) => void (hunkRefs.current[conflictPickIdx] = el) : undefined}
                tabIndex={isConflict ? 0 : undefined}
                role={isConflict ? "group" : undefined}
                aria-label={isConflict ? t("sync.conflict.hunk", { n: conflictPickIdx + 1, total }) : undefined}
                onFocus={isConflict ? () => setCurrent(conflictPickIdx) : undefined}
                style={{
                  ...cols,
                  borderBottom: "1px solid hsl(var(--border))",
                  background:
                    h.op === "conflict"
                      ? "hsl(var(--danger) / 0.06)"
                      : h.op === "local"
                        ? "hsl(var(--accent) / 0.06)"
                        : h.op === "remote"
                          ? "hsl(var(--info) / 0.06)"
                          : undefined,
                }}
              >
                <Side
                  hunk={h}
                  side="local"
                  isPicked={
                    h.op === "local" ||
                    h.op === "equal" ||
                    h.op === "both" ||
                    (h.op === "conflict" && picks[conflictPickIdx] !== "remote")
                  }
                  onPick={
                    h.op === "conflict"
                      ? () => setPick(conflictPickIdx, "local")
                      : undefined
                  }
                />
                <Side hunk={h} side="base" isPicked={h.op === "equal"} />
                <Side
                  hunk={h}
                  side="remote"
                  isPicked={
                    h.op === "remote" ||
                    h.op === "equal" ||
                    h.op === "both" ||
                    (h.op === "conflict" && picks[conflictPickIdx] !== "local")
                  }
                  onPick={
                    h.op === "conflict"
                      ? () => setPick(conflictPickIdx, "remote")
                      : undefined
                  }
                />
                {isConflict && (
                  <div role="radiogroup" aria-label={t("sync.conflict.hunk", { n: conflictPickIdx + 1, total })} style={{ gridColumn: "1 / span 3", padding: "4px 12px", fontSize: 11, color: "hsl(var(--fg-muted))", display: "flex", gap: 12 }}>
                    <label>
                      <input type="radio" name={`conflict-${i}`} checked={picks[conflictPickIdx] === "local"} onChange={() => setPick(conflictPickIdx, "local")} /> {L.local}
                    </label>
                    <label>
                      <input type="radio" name={`conflict-${i}`} checked={picks[conflictPickIdx] === "remote"} onChange={() => setPick(conflictPickIdx, "remote")} /> {L.remote}
                    </label>
                    <label>
                      <input type="radio" name={`conflict-${i}`} checked={picks[conflictPickIdx] === "both"} onChange={() => setPick(conflictPickIdx, "both")} /> {t("sync.conflict.both")}
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: "8px 18px", borderTop: "1px solid hsl(var(--border))", display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="conflict-result" style={{ fontWeight: 600, fontSize: 12, flex: 1 }}>
              {t("sync.conflict.result")}
            </label>
            {edited !== null && (
              <button type="button" onClick={() => setEdited(null)} style={btnSecondary}>
                {t("sync.conflict.resetResult")}
              </button>
            )}
          </div>
          <textarea
            id="conflict-result"
            dir="auto"
            value={result}
            onChange={(e) => setEdited(e.target.value)}
            aria-describedby="conflict-result-hint"
            rows={6}
            style={{ width: "100%", boxSizing: "border-box", fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 12, padding: 8, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "inherit", resize: "vertical" }}
          />
          <div id="conflict-result-hint" style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
            {t("sync.conflict.resultHint")}
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "12px 18px",
            borderTop: "1px solid hsl(var(--border))",
          }}
        >
          <button onClick={() => onResolve(null)} style={btnSecondary}>{L.cancel}</button>
          <button onClick={() => onResolve({ kind: "local" })} style={btnSecondary}>{L.takeLocal}</button>
          <button onClick={() => onResolve({ kind: "remote" })} style={btnSecondary}>{L.takeRemote}</button>
          <button
            onClick={() =>
              onResolve({
                kind: "merged",
                content: result,
              })
            }
            style={btnPrimary}
          >
            {L.merge}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

interface SideProps {
  hunk: DiffHunk;
  side: "local" | "base" | "remote";
  isPicked: boolean;
  onPick?: () => void;
}

function Side({ hunk, side, isPicked, onPick }: SideProps) {
  const lines = side === "local" ? hunk.local : side === "base" ? hunk.base : hunk.remote;
  return (
    <div
      onClick={onPick}
      style={{
        padding: "6px 12px",
        opacity: isPicked ? 1 : 0.4,
        cursor: onPick ? "pointer" : "default",
        whiteSpace: "pre-wrap",
        borderInlineEnd: side !== "remote" ? "1px solid hsl(var(--border))" : undefined,
      }}
    >
      {lines.length === 0 ? (
        // empty-allow: marks an empty side of a diff, not an empty state
        <span style={{ color: "hsl(var(--fg-muted))", fontStyle: "italic", fontSize: 11 }}>{t("sync.conflict.empty")}</span>
      ) : (
        lines.map((l, i) => (
          <div key={i}>{l || "\u00A0"}</div>
        ))
      )}
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 12,
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  background: "transparent",
  color: "hsl(var(--fg))",
  cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 12,
  border: "none",
  borderRadius: 6,
  background: "hsl(var(--accent))",
  color: "hsl(var(--accent-fg))",
  cursor: "pointer",
};

/**
 * Imperative entrypoint — opens the dialog and resolves the promise
 * with the user's choice. Mirrors the `uiPrompt` / `uiConfirm` flow
 * used elsewhere in Lumen.
 */
export function openConflictDialog(opts: {
  path: string;
  base: string;
  local: string;
  remote: string;
  labels?: Partial<ConflictLabels>;
  hunks?: DiffHunk[];
}): Promise<ConflictChoice> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const cleanup = () => {
      try {
        root.unmount();
      } catch {
        /* why: the root may already be unmounted by an earlier close */
      }
      host.remove();
    };
    root.render(
      <ConflictDialogImpl
        {...opts}
        onResolve={(v) => {
          cleanup();
          resolve(v);
        }}
      />,
    );
  });
}
