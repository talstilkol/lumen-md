/**
 * The compare view (plan W13.R8): two notes, or two versions of one,
 * side by side or merged into one column, word by word (./wordDiffBidi.ts).
 *
 * - Two columns, the old one first: in a right-to-left layout it is on the
 *   right. Rows are paragraphs, so the two sides stay level; long unchanged
 *   stretches fold to a "show N unchanged paragraphs" bar.
 * - Inline: one column, deletions struck through, insertions underlined.
 * - Options: ignore niqqud, ignore whitespace (kept per device).
 * - F7 / Shift+F7 (and the buttons) go to the next / previous change; the
 *   change is announced for a screen reader ("Change 3 of 12: deleted …,
 *   inserted …"). Changes are marked by more than colour: strike-through,
 *   underline, a dotted underline for a niqqud change.
 * - Paragraphs take their own direction (`dir="auto"`); the marks inside a
 *   paragraph are plain inline elements, so the bidi algorithm orders the
 *   paragraph exactly as it orders the text without them.
 */
import "./readingViewsStrings";
import "./CompareView.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "../ui/Modal";
import { t } from "../i18n";
import { announce } from "../a11y/announce";
import { changeRuns, rows as toRows, wordDiff, type DiffOptions, type Piece, type Row, type RowPiece } from "./wordDiffBidi";

export interface CompareSide {
  /** What the column header says: a note's name, "Version of 12:04", "This device". */
  label: string;
  text: string;
}

interface Props {
  left: CompareSide;
  right: CompareSide;
  onClose: () => void;
}

type Layout = "columns" | "inline";
const PREFS_KEY = "lumen.compare";

function loadPrefs(): { layout: Layout } & DiffOptions {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<{ layout: Layout } & DiffOptions>;
    return { layout: v.layout === "inline" ? "inline" : "columns", ignoreNiqqud: v.ignoreNiqqud === true, ignoreWhitespace: v.ignoreWhitespace === true };
  } catch {
    return { layout: "columns", ignoreNiqqud: false, ignoreWhitespace: false };
  }
}

function savePrefs(p: { layout: Layout } & DiffOptions): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* why: private mode / blocked storage — the choice lasts for this view only */
  }
}

/** One side of a piece: "old" shows deletions, "new" insertions, "both" (inline) shows both. */
function renderPiece(p: Piece, side: "old" | "new" | "both", change: number, key: string): ReactNode {
  const ch = change >= 0 ? { "data-ch": change } : {};
  switch (p.type) {
    case "equal":
      return p.text;
    case "delete":
      return side === "new" ? null : (
        <del key={key} className="cmp-del" {...ch}>
          {p.text}
        </del>
      );
    case "insert":
      return side === "old" ? null : (
        <ins key={key} className="cmp-ins" {...ch}>
          {p.text}
        </ins>
      );
    case "niqqud": {
      const text = side === "old" ? p.oldText : p.text;
      return (
        <span key={key} className="cmp-niqqud" title={t("readingViews.compare.niqqudChange", { old: p.oldText, new: p.text })} {...ch}>
          {side === "both" ? p.text : text}
        </span>
      );
    }
    case "prefix": {
      const stem = side === "old" ? p.oldStem : p.stem;
      const stemNode = p.oldStem !== p.stem ? <span className="cmp-niqqud">{stem}</span> : stem;
      // The word stays one word: the prefix marks sit inside it, the letters join as they would.
      return (
        <span key={key} className="cmp-word" {...ch}>
          {side !== "new" && p.oldPrefix && <del className="cmp-del">{p.oldPrefix}</del>}
          {side !== "old" && p.newPrefix && <ins className="cmp-ins">{p.newPrefix}</ins>}
          {stemNode}
        </span>
      );
    }
  }
}

function describe(pieces: Piece[]): string {
  const parts: string[] = [];
  const clip = (s: string) => (s.length > 80 ? s.slice(0, 77) + "…" : s).trim();
  for (const p of pieces) {
    if (p.type === "delete") parts.push(t("readingViews.compare.sayDeleted", { text: clip(p.text) }));
    else if (p.type === "insert") parts.push(t("readingViews.compare.sayInserted", { text: clip(p.text) }));
    else if (p.type === "prefix") parts.push(t("readingViews.compare.sayPrefix", { old: p.oldPrefix + p.oldStem, new: p.newPrefix + p.stem }));
    else if (p.type === "niqqud") parts.push(t("readingViews.compare.niqqudChange", { old: p.oldText, new: p.text }));
  }
  return parts.join("; ");
}

/** Rows to show: unchanged stretches longer than 2×CONTEXT+2 fold, keeping CONTEXT rows on each side. */
const CONTEXT = 2;
type Shown = { kind: "row"; row: Row; index: number } | { kind: "fold"; from: number; to: number };

function fold(all: Row[], open: ReadonlySet<number>): Shown[] {
  const changed = all.map((r) => r.old.some((p) => p.type !== "equal") || r.new.some((p) => p.type !== "equal"));
  const out: Shown[] = [];
  let i = 0;
  while (i < all.length) {
    if (changed[i]) {
      out.push({ kind: "row", row: all[i], index: i });
      i++;
      continue;
    }
    let j = i;
    while (j < all.length && !changed[j]) j++;
    const start = i === 0 ? 0 : i + CONTEXT;
    const end = j === all.length ? j : j - CONTEXT;
    if (end - start > 2 && !open.has(i)) {
      for (let k = i; k < start; k++) out.push({ kind: "row", row: all[k], index: k });
      out.push({ kind: "fold", from: start, to: end });
      for (let k = end; k < j; k++) out.push({ kind: "row", row: all[k], index: k });
    } else for (let k = i; k < j; k++) out.push({ kind: "row", row: all[k], index: k });
    i = j;
  }
  return out;
}

export function CompareView({ left, right, onClose }: Props) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const update = (p: Partial<typeof prefs>) =>
    setPrefs((old) => {
      const next = { ...old, ...p };
      savePrefs(next);
      return next;
    });
  const opts: DiffOptions = { ignoreNiqqud: prefs.ignoreNiqqud, ignoreWhitespace: prefs.ignoreWhitespace };
  const pieces = useMemo(() => wordDiff(left.text, right.text, opts), [left.text, right.text, opts.ignoreNiqqud, opts.ignoreWhitespace]); // eslint-disable-line react-hooks/exhaustive-deps
  const runs = useMemo(() => changeRuns(pieces), [pieces]);
  const allRows = useMemo(() => toRows(pieces), [pieces]);
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const shown = useMemo(() => fold(allRows, opened), [allRows, opened]);
  const [current, setCurrent] = useState(-1);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCurrent(-1);
    setOpened(new Set());
  }, [pieces]);

  const go = useCallback(
    (delta: number) => {
      if (!runs.length) {
        announce(t("readingViews.compare.none"));
        return;
      }
      setCurrent((c) => {
        const next = c < 0 ? (delta > 0 ? 0 : runs.length - 1) : (c + delta + runs.length) % runs.length;
        const r = runs[next];
        announce(t("readingViews.compare.sayChange", { i: String(next + 1), n: String(runs.length), what: describe(pieces.slice(r.from, r.to + 1)) }));
        return next;
      });
    },
    [runs, pieces],
  );

  // The current change: open its fold if it is folded, mark it and bring it into view.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || current < 0) return;
    const els = body.querySelectorAll<HTMLElement>(`[data-ch="${current}"]`);
    if (!els.length) return;
    for (const el of body.querySelectorAll(".cmp-current")) el.classList.remove("cmp-current");
    for (const el of els) el.classList.add("cmp-current");
    els[0].scrollIntoView({ block: "center" });
  }, [current, shown]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "F7") {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    }
  };

  const cell = (pieces: RowPiece[], side: "old" | "new" | "both", rowKey: string) => trimEnd(pieces).map((p, i) => renderPiece(p, side, p.ch, `${rowKey}-${i}`));
  const stats = useMemo(() => {
    let ins = 0;
    let del = 0;
    for (const p of pieces) {
      if (p.type === "insert") ins++;
      else if (p.type === "delete") del++;
      else if (p.type !== "equal") {
        ins++;
        del++;
      }
    }
    return { ins, del };
  }, [pieces]);

  return (
    <Modal onClose={onClose} aria-labelledby="cmp-title" className="cmp-dialog" data-testid="compare-view" data-reading-mode="compare" data-changes={String(runs.length)} onKeyDown={onKeyDown}>
      <header className="cmp-head">
        <h2 id="cmp-title" className="cmp-title">
          {t("readingViews.compare.title")}
        </h2>
        <div className="cmp-tools" role="toolbar" aria-label={t("readingViews.compare.tools")}>
          <div className="cmp-seg" role="group" aria-label={t("readingViews.compare.layout")}>
            <button type="button" aria-pressed={prefs.layout === "columns"} onClick={() => update({ layout: "columns" })} data-testid="compare-columns">
              {t("readingViews.compare.columns")}
            </button>
            <button type="button" aria-pressed={prefs.layout === "inline"} onClick={() => update({ layout: "inline" })} data-testid="compare-inline">
              {t("readingViews.compare.inline")}
            </button>
          </div>
          <label className="cmp-opt">
            <input type="checkbox" checked={!!prefs.ignoreNiqqud} onChange={(e) => update({ ignoreNiqqud: e.target.checked })} data-testid="compare-ignore-niqqud" />
            {t("readingViews.compare.ignoreNiqqud")}
          </label>
          <label className="cmp-opt">
            <input type="checkbox" checked={!!prefs.ignoreWhitespace} onChange={(e) => update({ ignoreWhitespace: e.target.checked })} data-testid="compare-ignore-space" />
            {t("readingViews.compare.ignoreWhitespace")}
          </label>
          <button type="button" onClick={() => go(-1)} aria-keyshortcuts="Shift+F7" data-testid="compare-prev">
            {t("readingViews.compare.prev")}
          </button>
          <button type="button" onClick={() => go(1)} aria-keyshortcuts="F7" data-testid="compare-next">
            {t("readingViews.compare.next")}
          </button>
          <span className="cmp-count" data-testid="compare-count">
            {runs.length
              ? current >= 0
                ? t("readingViews.compare.position", { i: String(current + 1), n: String(runs.length) })
                : t("readingViews.compare.count", { n: String(runs.length), ins: String(stats.ins), del: String(stats.del) })
              : t("readingViews.compare.none")}
          </span>
          <button type="button" className="cmp-close" onClick={onClose}>
            {t("readingViews.compare.close")}
          </button>
        </div>
      </header>
      <div ref={bodyRef} className={`cmp-body cmp-${prefs.layout}`} data-testid="compare-body" tabIndex={0} aria-label={t("readingViews.compare.body")}>
        {prefs.layout === "columns" ? (
          <div className="cmp-grid" role="table" aria-label={t("readingViews.compare.title")}>
            <div className="cmp-row cmp-labels" role="row">
              <div className="cmp-cell cmp-label" role="columnheader" dir="auto" data-testid="compare-old-label">
                {t("readingViews.compare.before", { name: left.label })}
              </div>
              <div className="cmp-cell cmp-label" role="columnheader" dir="auto" data-testid="compare-new-label">
                {t("readingViews.compare.after", { name: right.label })}
              </div>
            </div>
            {shown.map((s) =>
              s.kind === "fold" ? (
                <div className="cmp-row" role="row" key={`f${s.from}`}>
                  <div className="cmp-fold" role="cell">
                    <button type="button" onClick={() => setOpened(new Set([...opened, s.from - CONTEXT, s.from]))}>
                      {t("readingViews.compare.unchanged", { n: String(s.to - s.from) })}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cmp-row" role="row" key={s.index} data-row={s.index}>
                  <div className="cmp-cell cmp-old" role="cell" dir="auto" data-sl={s.index + 1} data-sle={s.index + 1}>
                    {cell(s.row.old, "old", `o${s.index}`)}
                  </div>
                  <div className="cmp-cell cmp-new" role="cell" dir="auto" data-sl={s.index + 1} data-sle={s.index + 1}>
                    {cell(s.row.new, "new", `n${s.index}`)}
                  </div>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="cmp-inline-body">
            <div className="cmp-label" dir="auto">
              {t("readingViews.compare.inlineLabel", { old: left.label, new: right.label })}
            </div>
            {shown.map((s) =>
              s.kind === "fold" ? (
                <div className="cmp-fold" key={`f${s.from}`}>
                  <button type="button" onClick={() => setOpened(new Set([...opened, s.from - CONTEXT, s.from]))}>
                    {t("readingViews.compare.unchanged", { n: String(s.to - s.from) })}
                  </button>
                </div>
              ) : (
                <p className="cmp-para" dir="auto" key={s.index} data-row={s.index}>
                  {inlineCell(s.row, `i${s.index}`)}
                </p>
              ),
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** A cell's pieces without the blank line that ends its paragraph (the row's border shows it). */
function trimEnd(pieces: RowPiece[]): RowPiece[] {
  const last = pieces[pieces.length - 1];
  if (!last || !("text" in last) || last.type === "niqqud" || !/\s+$/.test(last.text)) return pieces;
  const text = last.text.replace(/\s+$/, "");
  return text ? [...pieces.slice(0, -1), { ...last, text }] : pieces.slice(0, -1);
}

/** A row merged into one paragraph: the new side's pieces, with the old side's deletions in their place. */
function inlineCell(full: Row, key: string): ReactNode[] {
  const row = { old: trimEnd(full.old), new: trimEnd(full.new) };
  // Walk both sides together: equal pieces appear on both, deletions only on the old side, insertions only on the new.
  const out: ReactNode[] = [];
  let i = 0;
  let j = 0;
  let n = 0;
  while (i < row.old.length || j < row.new.length) {
    const o = row.old[i];
    const w = row.new[j];
    if (o && o.type === "delete") {
      out.push(renderPiece(o, "both", o.ch, `${key}-${n++}`));
      i++;
    } else if (w && w.type === "insert") {
      out.push(renderPiece(w, "both", w.ch, `${key}-${n++}`));
      j++;
    } else {
      // A piece both sides show (equal, prefix, niqqud): once.
      const p = w ?? o!;
      out.push(renderPiece(p, "both", p.ch, `${key}-${n++}`));
      i++;
      j++;
    }
  }
  return out;
}
