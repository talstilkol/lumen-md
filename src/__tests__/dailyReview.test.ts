/**
 * Plan W3.3 (W10.E46): spaced repetition inside the daily note. A daily
 * template with {{review}} gets the day's queue — the same dailyQueue the
 * review panel uses — each card's question, its answer folded, and the link
 * to its place. The vault is the in-memory OPFS (helpers/fakeOpfs) and the
 * cards come from real notes through qaCards / syncSources / rate.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { useAppStore } from "../store/useStore";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import { DEFAULT_DAILY, ensureDailyNote, renderTemplate, reviewQueueFor, reviewSection } from "../daily/dailyNote";
import { emptyReviewFile, qaCards, rate, REVIEW_PATH, serializeReviewFile, syncSources } from "../srs/cards";
import { fsrs } from "../srs/fsrs";

const NOTE = "# Hebrew\n\n- What is the plural of ספר? :: ספרים\n- Which letter has a dagesh in בית? :: ב\n";
const day = { y: 2026, m: 11, d: 15 };
const at = (iso: string) => new Date(iso);

/** A review file from the note: both cards added on the 10th, the first one reviewed then (due again later). */
function reviewFile() {
  let f = syncSources(emptyReviewFile(), qaCards("notes/hebrew.md", NOTE), at("2026-11-10T09:00:00Z"));
  const [first] = Object.keys(f.cards);
  f = rate(f, first, 3, at("2026-11-10T09:00:00Z"), fsrs());
  return f;
}

describe("the review section", () => {
  it("a heading with the count; each question, its answer folded, the link to its note", () => {
    const f = syncSources(emptyReviewFile(), qaCards("notes/hebrew.md", NOTE), at("2026-11-10T09:00:00Z"));
    const out = reviewSection(Object.values(f.cards)).split("\n");
    expect(out.slice(0, 10)).toEqual([
      "## Review (2)",
      "",
      "- What is the plural of ספר? ([[notes/hebrew.md]])",
      "  > [!question]- Answer",
      "  > ספרים",
      "",
      "- Which letter has a dagesh in בית? ([[notes/hebrew.md]])",
      "  > [!question]- Answer",
      "  > ב",
      "",
    ]);
    // The palette shortcut is written for this platform (⌘K or Ctrl+K).
    expect(out[10]).toMatch(/^Rate them in the review panel \((⌘K|Ctrl\+K) → Daily review\), which keeps the schedule\.$/);
    expect(reviewSection([])).toBe("## Review (0)\n\nNothing to review today.\n");
  });

  it("{{review}} in a template is the section; without a queue it says there is nothing", () => {
    const f = syncSources(emptyReviewFile(), qaCards("notes/hebrew.md", NOTE), at("2026-11-10T09:00:00Z"));
    const out = renderTemplate("# {{date}}\n\n{{review}}", day, "en", { review: Object.values(f.cards) });
    expect(out.startsWith("# 2026-11-15\n\n## ")).toBe(true);
    expect(out).toContain("- What is the plural of ספר? ([[notes/hebrew.md]])");
    expect(renderTemplate("{{review}}", day, "en")).toBe(reviewSection([]));
  });
});

describe("the day's queue from the vault's review file", () => {
  beforeEach(() => {
    installFakeOpfs();
    useAppStore.setState({ doc: { name: "Untitled.md", content: "", dirty: false, workspaceName: null }, openTabs: [] });
  });

  it("the queue the review panel builds: a card due by the end of the day, and the new card; none without a file", async () => {
    const read = (p: string) => readWorkspaceFile(p);
    expect(await reviewQueueFor(day, read)).toEqual([]);
    const f = reviewFile();
    await writeWorkspaceFile(REVIEW_PATH, serializeReviewFile(f));
    const q = await reviewQueueFor(day, read);
    const due = Object.values(f.cards).find((e) => e.card.state !== "new")!;
    // The reviewed card's next date decides whether it is in today's queue.
    const dueToday = due.card.due <= "2026-11-15T23:59:59.000Z";
    expect(q.map((e) => e.front)).toEqual([...(dueToday ? [due.front] : []), "Which letter has a dagesh in בית?"]);
  });

  it("a new daily note from a template with {{review}} carries the day's cards; the rest of the template as before", async () => {
    await writeWorkspaceFile(REVIEW_PATH, serializeReviewFile(syncSources(emptyReviewFile(), qaCards("notes/hebrew.md", NOTE), at("2026-11-10T09:00:00Z"))));
    const p = await ensureDailyNote(day, { ...DEFAULT_DAILY, template: "# {{date}}\n\n{{review}}" }, "en");
    const text = await readWorkspaceFile(p);
    expect(text.startsWith("# 2026-11-15\n\n## ")).toBe(true);
    expect(text).toContain("- What is the plural of ספר? ([[notes/hebrew.md]])\n  > [!question]- ");
    expect(text).toContain("  > ספרים\n");
    expect(text).toContain("- Which letter has a dagesh in בית? ([[notes/hebrew.md]])");
  });

  it("a template without {{review}} does not read the review file at all", async () => {
    await writeWorkspaceFile(REVIEW_PATH, "{ not json");
    const p = await ensureDailyNote({ y: 2026, m: 11, d: 16 }, { ...DEFAULT_DAILY, template: "# {{date}}\n" }, "en");
    expect(await readWorkspaceFile(p)).toBe("# 2026-11-16\n");
  });
});
