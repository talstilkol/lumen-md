/**
 * "Follow a learning plan" (plan W12.H4): the four study cycles, each with
 * today's reading (a link to its text on Sefaria), a Follow switch, and for
 * a followed cycle its progress since the day it was followed: days marked
 * learned out of days due, how many are not marked, "Learned today" and
 * "Review later" (a flashcard in the FSRS queue, plans.reviewCards).
 *
 * Pure UI over src/learning/plans.ts: every change goes to `onChange` with
 * the new file; ./open.tsx saves it to .lumen/learning.json.
 */
import { useState, type ChangeEvent } from "react";
import { t } from "../i18n";
import "./learningStrings";
import { Modal } from "../ui/Modal";
import type { GDay } from "../daily/hebrewCalendar";
import { CYCLES, follow, iso, markDone, markForReview, progress, readingOf, unfollow, type CycleId, type LearningFile } from "./plans";

export interface LearningPlansProps {
  file: LearningFile;
  today: GDay;
  lang: "he" | "en";
  onChange: (f: LearningFile) => void | Promise<void>;
  onClose: () => void;
}

export function LearningPlansDialog({ file: initial, today, lang, onChange, onClose }: LearningPlansProps) {
  const [file, setFile] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const day = iso(today);

  const apply = async (next: LearningFile) => {
    setFile(next);
    setError(null);
    try {
      await onChange(next);
    } catch (e) {
      setError(t("learning.saveFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <Modal aria-label={t("learning.title")} onClose={onClose} className="learning-plans" data-testid="learning-plans" style={{ maxInlineSize: 560, inlineSize: "100%" }}>
      <h2 style={{ marginBlock: "0 8px", fontSize: 18 }}>{t("learning.title")}</h2>
      {error && <div role="alert">{error}</div>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
        {CYCLES.map((cycle) => (
          <CycleRow key={cycle} cycle={cycle} file={file} today={today} day={day} lang={lang} apply={apply} />
        ))}
      </ul>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBlockStart: 12 }}>
        <button type="button" onClick={onClose}>
          {t("learning.close")}
        </button>
      </div>
    </Modal>
  );
}

function CycleRow({ cycle, file, today, day, lang, apply }: { cycle: CycleId; file: LearningFile; today: GDay; day: string; lang: "he" | "en"; apply: (f: LearningFile) => void }) {
  const reading = readingOf(cycle, today, lang);
  const plan = file.plans.find((p) => p.cycle === cycle);
  const id = `learning-${cycle}`;
  const name = reading?.name ?? cycle;
  const pr = plan ? progress(plan, today) : null;
  const learned = !!plan?.done.includes(day);
  const marked = !!plan?.review?.includes(day);
  return (
    <li data-testid={id} data-following={plan ? "true" : "false"} style={{ display: "grid", gap: 4, borderBlockEnd: "1px solid hsl(var(--border, 0 0% 85%))", paddingBlockEnd: 8 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
        <input type="checkbox" checked={!!plan} onChange={(e: ChangeEvent<HTMLInputElement>) => apply(e.currentTarget.checked ? follow(file, cycle, today) : unfollow(file, cycle))} aria-describedby={`${id}-today`} />
        <span>{name}</span>
        <span style={{ fontWeight: 400, color: "hsl(var(--fg-muted, 0 0% 40%))", fontSize: 12 }}>{t("learning.follow")}</span>
      </label>
      <div id={`${id}-today`} dir="auto">
        {reading ? (
          <>
            {t("learning.today")}{" "}
            <a href={reading.url} target="_blank" rel="noopener noreferrer">
              {reading.label}
            </a>
          </>
        ) : (
          t("learning.none")
        )}
      </div>
      {plan && pr && (
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <progress value={pr.done} max={Math.max(1, pr.due)} aria-label={`${name}: ${t("learning.progress", { done: pr.done, due: pr.due })}`} style={{ flex: "1 1 160px" }} />
            <span data-testid={`${id}-progress`}>{t("learning.progress", { done: pr.done, due: pr.due })}</span>
            <span data-testid={`${id}-behind`} style={{ color: "hsl(var(--fg-muted, 0 0% 40%))" }}>
              {pr.behind.length ? t("learning.behind", { count: pr.due - pr.done }) : t("learning.upToDate")}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" aria-pressed={learned} onClick={() => apply(markDone(file, cycle, today, !learned))} disabled={!reading}>
              {t("learning.learned")}
            </button>
            <button type="button" onClick={() => apply(markForReview(file, cycle, today))} disabled={!reading || marked}>
              {marked ? t("learning.reviewMarked") : t("learning.review")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default LearningPlansDialog;
