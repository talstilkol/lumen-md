/**
 * W11.Q4: the notice shown when a note too large for WYSIWYG opens in the
 * source editor instead, and the warning shown when the person chose WYSIWYG
 * anyway. The ceiling itself is editor/wysiwygCeiling.ts.
 */
import { useRef } from "react";
import { formatNumber, t } from "../i18n";
import type { ViewMode } from "../store/useStore";
import { wysiwygCeiling, type CeilingVerdict } from "../editor/wysiwygCeiling";

const UNDER: CeilingVerdict = { tooLarge: false, bytes: 0, blocks: 0, reason: null };

/**
 * The verdict for the open note, decided when the note is opened in WYSIWYG
 * (another note, or the view switched to WYSIWYG), not on every keystroke:
 * a note that grows past the ceiling while being edited stays where it is.
 * A note whose text had not loaded yet (empty) is decided again when it has.
 */
export function useWysiwygCeiling(mode: ViewMode, path: string | null, content: string): CeilingVerdict {
  const memo = useRef<{ path: string | null; verdict: CeilingVerdict; empty: boolean } | null>(null);
  const prevMode = useRef<ViewMode | null>(null);
  const entered = mode === "wysiwyg" && prevMode.current !== "wysiwyg";
  prevMode.current = mode;
  if (mode !== "wysiwyg") return UNDER;
  const m = memo.current;
  if (entered || !m || m.path !== path || (m.empty && content)) memo.current = { path, verdict: wysiwygCeiling(content), empty: !content };
  return memo.current!.verdict;
}

const kb = (bytes: number) => formatNumber(Math.round(bytes / 1024));

/** Above the source editor: why the note is not in WYSIWYG, and the way to it anyway. */
export function WysiwygCeilingNotice({ verdict, onOpenAnyway }: { verdict: CeilingVerdict; onOpenAnyway: () => void }) {
  return (
    <div role="status" data-testid="wysiwyg-ceiling-notice" className="px-3 py-2 text-xs border-b border-border bg-bg-subtle flex flex-wrap items-center gap-2" dir="auto">
      <span>{t(verdict.reason === "blocks" ? "editor.wysiwygCeiling.blocks" : "editor.wysiwygCeiling.bytes", { kb: kb(verdict.bytes), blocks: formatNumber(verdict.blocks) })}</span>
      <button type="button" className="underline" onClick={onOpenAnyway} title={t("editor.wysiwygCeiling.warning")}>
        {t("editor.wysiwygCeiling.openAnyway")}
      </button>
    </div>
  );
}

/** Above the WYSIWYG editor, when it was chosen for a note over the ceiling. */
export function WysiwygCeilingWarning({ onBack }: { onBack: () => void }) {
  return (
    <div role="alert" data-testid="wysiwyg-ceiling-warning" className="px-3 py-2 text-xs border-b border-border bg-bg-subtle flex flex-wrap items-center gap-2" dir="auto">
      <span>{t("editor.wysiwygCeiling.warning")}</span>
      <button type="button" className="underline" onClick={onBack}>
        {t("editor.wysiwygCeiling.backToSource")}
      </button>
    </div>
  );
}
