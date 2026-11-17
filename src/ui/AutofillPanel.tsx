/**
 * The approval queue for AI-filled properties (plan 5.10): each proposal
 * shows its note and every property's before → after; nothing is written
 * until Approve (one note) or Approve all. Lazy — mounted by
 * "AI: Fill Properties…", never in the startup bundle.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Check, X } from "lucide-react";
import { t } from "../i18n";
import { AutofillQueue, type Proposal } from "../properties/autofill";
import { showAiToast } from "./AiToast";
import "./autofillPanelStrings";
import { HelpButton } from "./HelpButton";
import { explainError } from "../lib/userError";
import { EmptyState, runCommand } from "./EmptyState";
import { Modal } from "./Modal";

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };

let queue: AutofillQueue | null = null;

/** The one queue of this tab, writing through the vault (the only writer is approve()). */
export function autofillQueue(): AutofillQueue {
  return (queue ??= new AutofillQueue({
    read: async (path) => (await import("../storage/workspace")).readWorkspaceFile(path),
    write: async (path, text) => {
      const ws = await import("../storage/workspace");
      await ws.writeWorkspaceFile(path, text);
      // The open note follows the approved write (it was clean: the proposal's base was its text).
      (await import("../store/externalChanges")).showOwnWrite(path, text);
      window.dispatchEvent(new CustomEvent("lumen-workspace-changed"));
    },
  }));
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

/**
 * The note as a reader names it: its title (the file name without ".md")
 * and, muted, its folder. Each part is its own bidi isolate, so a Hebrew
 * name keeps "2027" and the folder in place instead of the ".md" jumping to
 * the far side of a right-to-left line.
 */
export function NotePath({ path }: { path: string }) {
  const parts = path.split("/");
  const name = parts.pop()!.replace(/\.md$/i, "");
  return (
    <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }} title={path} data-testid="autofill-note">
      <strong>
        <bdi>{name}</bdi>
      </strong>
      {parts.length > 0 && (
        <span style={{ color: "hsl(var(--fg-muted))", fontSize: 12, marginInlineStart: 8 }}>
          {parts.map((f, i) => (
            <span key={i}>
              {i > 0 && " / "}
              <bdi>{f}</bdi>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function Row({ p, busy, onApprove, onReject }: { p: Proposal; busy: boolean; onApprove: () => void; onReject: () => void }) {
  return (
    <li data-testid="autofill-proposal" data-path={p.path} style={{ padding: "10px 16px", borderBottom: "1px solid hsl(var(--border))", listStyle: "none" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <NotePath path={p.path} />
        <button type="button" style={btn} disabled={busy} onClick={onApprove} data-testid="autofill-approve">
          <Check size={12} /> {t("autofill.approve")}
        </button>
        <button type="button" style={btn} disabled={busy} onClick={onReject} data-testid="autofill-reject">
          <X size={12} /> {t("autofill.reject")}
        </button>
      </div>
      <table style={{ width: "100%", fontSize: 12, marginTop: 6, borderCollapse: "collapse" }}>
        <tbody>
          {p.changes.map((c) => (
            <tr key={c.key}>
              <td style={{ padding: "2px 6px", color: "hsl(var(--fg-muted))" }}>{c.key}</td>
              <td style={{ padding: "2px 6px", textDecoration: "line-through", color: "hsl(var(--fg-muted))" }} dir="auto">
                {show(c.before)}
              </td>
              <td style={{ padding: "2px 6px" }} dir="auto">
                {show(c.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}

export function AutofillPanel({ onClose }: { onClose: () => void }) {
  const q = autofillQueue();
  const [items, setItems] = useState<readonly Proposal[]>(q.list());
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** After a row is approved or rejected it leaves the list: focus goes to the row now at its place (or the last one, or the empty state's action), never to <body>. */
  const focusAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    const i = focusAt.current;
    if (i === null || busy) return;
    focusAt.current = null;
    const body = bodyRef.current;
    if (!body) return;
    const rows = body.querySelectorAll<HTMLButtonElement>('[data-testid="autofill-approve"]');
    (rows[Math.min(i, rows.length - 1)] ?? body.querySelector<HTMLButtonElement>('[data-testid="empty-state-action"]'))?.focus();
  }, [items, busy]);

  useEffect(() => {
    const off = q.subscribe(() => setItems(q.list()));
    return () => {
      off();
    };
  }, [q, onClose]);

  const approve = async (ids: string[]) => {
    setBusy(true);
    let written = 0;
    let stale = 0;
    try {
      for (const id of ids) {
        const r = await q.approve(id);
        if (r === "written") written++;
        else if (r === "stale") stale++;
      }
    } catch (e) {
      showAiToast(explainError(e), "error");
    } finally {
      setBusy(false);
    }
    if (written) showAiToast(t("autofill.written", { n: written }), "success");
    if (stale) showAiToast(t("autofill.stale", { n: stale }), "info");
  };

  return (
    <Modal onClose={onClose} className="cmd-palette-backdrop" onClick={onClose} aria-label={t("autofill.title")}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, padding: 0, display: "flex", flexDirection: "column", maxHeight: "82vh" }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <strong style={{ flex: 1 }}>{t("autofill.title")}</strong>
          <HelpButton topic="workspace/ai-autofill" />
          <button
            type="button"
            style={btn}
            disabled={busy || !items.length}
            onClick={() => {
              focusAt.current = 0;
              void approve(items.map((p) => p.id));
            }}
            data-testid="autofill-approve-all"
          >
            {t("autofill.approveAll", { n: items.length })}
          </button>
          <button type="button" style={btn} onClick={onClose} aria-label={t("privacy.close")}>
            <X size={14} />
          </button>
        </header>
        <p style={{ margin: 0, padding: "8px 16px", fontSize: 12, color: "hsl(var(--fg-muted))" }}>{t("autofill.hint")}</p>
        {/* a scrolling region a keyboard user can reach (tabIndex 0), named for a screen reader */}
        <div ref={bodyRef} style={{ overflow: "auto", flex: 1 }} tabIndex={0} role="region" aria-label={t("autofill.title")}>
          {items.length === 0 ? (
            <EmptyState message={t("autofill.empty")} action={{ label: t("cmd.ai.autofill"), onClick: () => (onClose(), runCommand("ai.autofill")) }} />
          ) : (
            <ul style={{ margin: 0, padding: 0 }}>
              {items.map((p) => (
                <Row
                  key={p.id}
                  p={p}
                  busy={busy}
                  onApprove={() => {
                    focusAt.current = items.indexOf(p);
                    void approve([p.id]);
                  }}
                  onReject={() => {
                    focusAt.current = items.indexOf(p);
                    q.reject(p.id);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

let mounted: { root: Root; host: HTMLElement } | null = null;

export function openAutofillPanel(): void {
  if (mounted) return;
  const host = document.createElement("div");
  host.id = "autofill-panel-root";
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    if (!mounted) return;
    const m = mounted;
    mounted = null;
    m.root.unmount();
    m.host.remove();
  };
  mounted = { root, host };
  root.render(<AutofillPanel onClose={close} />);
}
