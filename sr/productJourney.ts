/**
 * W11.Q6 (research R5.7, R1.12): the product journey for a screen reader, in
 * Hebrew and in English. Ten steps a person takes on a first day: open the
 * vault, a new note, a heading, the command palette, search, Settings opened
 * and closed with Escape, WYSIWYG, a link to another note, export.
 *
 * Every phrase the reader must speak is read from the app's own strings
 * (src/i18n/locales/<he|en>/*.json), so a renamed string moves the
 * expectation with it. A step passes when each expected phrase (or one of a
 * `[a, b]` pair) appears in what the reader spoke during that step; matching
 * is journey.ts's (whitespace collapsed, direction marks dropped).
 *
 * The protocol journey of W4.21 (journey.ts) stays as it is; this one runs
 * next to it in the nightly `sr` kind (VoiceOver on the Mac, with the Hebrew
 * voice Carmit for he: see docs editor/screen-reader-automation).
 */
import heCmd from "../src/i18n/locales/he/cmd.json";
import heCommon from "../src/i18n/locales/he/common.json";
import heEditor from "../src/i18n/locales/he/editor.json";
import heFiles from "../src/i18n/locales/he/files.json";
import enCmd from "../src/i18n/locales/en/cmd.json";
import enCommon from "../src/i18n/locales/en/common.json";
import enEditor from "../src/i18n/locales/en/editor.json";
import enFiles from "../src/i18n/locales/en/files.json";
import { missing, normalizeSpoken } from "./journey";

export type JourneyLocale = "he" | "en";

type Strings = Record<string, string>;
const STRINGS: Record<JourneyLocale, Strings> = {
  he: { ...heCmd, ...heCommon, ...heEditor, ...heFiles } as Strings,
  en: { ...enCmd, ...enCommon, ...enEditor, ...enFiles } as Strings,
};

/** The app's string, without a trailing ellipsis (readers say "…" differently or not at all). */
export function s(locale: JourneyLocale, id: string): string {
  const v = STRINGS[locale][id];
  if (typeof v !== "string") throw new Error(`productJourney: no string ${id} in ${locale}`);
  return v.replace(/[…]+$|\.\.\.$/, "").trim();
}

/** The vault the journey opens: two notes, so there is something to link to. */
export const VAULT: Record<JourneyLocale, Array<{ path: string; content: string }>> = {
  he: [
    { path: "רשימת קניות.md", content: "# רשימת קניות\n\n- [ ] לחם\n- [ ] חלב\n" },
    { path: "יומן.md", content: "# יומן\n\nהיום כתבתי פתק ראשון.\n" },
  ],
  en: [
    { path: "Shopping list.md", content: "# Shopping list\n\n- [ ] bread\n- [ ] milk\n" },
    { path: "Journal.md", content: "# Journal\n\nToday I wrote a first note.\n" },
  ],
};

/** One thing a step does, in order. `clear` empties the reader's log, so what came before cannot pass the step. */
export type Action = { press: string } | { type: string } | { focus: string } | { clear: true };

/** A step of the product journey. */
export interface ProductTask {
  id: number;
  title: string;
  actions: Action[];
  /** Phrases the reader must speak after the last `clear`; an array inside means "one of these". */
  expect: Array<string | string[]>;
}

const HEADING: Record<JourneyLocale, string> = { he: "כותרת חדשה", en: "New heading" };
const LINK_QUERY: Record<JourneyLocale, string> = { he: "רשימ", en: "Shop" };

export function productTasks(locale: JourneyLocale): ProductTask[] {
  const note = VAULT[locale][0].path.replace(/\.md$/, "");
  const editor = s(locale, "editor.ariaLabel");
  return [
    { id: 1, title: "open the vault: the first note in the file tree", actions: [{ focus: "aside.file-tree [role=treeitem]" }], expect: [note] },
    { id: 2, title: "a new note", actions: [{ press: "ControlOrMeta+N" }], expect: [[s(locale, "doc.untitled"), editor]] },
    { id: 3, title: "a heading is read as it is typed", actions: [{ type: `# ${HEADING[locale]}` }], expect: [HEADING[locale]] },
    { id: 4, title: "the command palette: its search field", actions: [{ press: "ControlOrMeta+K" }], expect: [s(locale, "palette.placeholder")] },
    { id: 5, title: "search the vault from the palette", actions: [{ type: s(locale, "cmd.search") }, { clear: true }, { press: "Enter" }], expect: [s(locale, "search.placeholder")] },
    { id: 6, title: "Settings open from the palette", actions: [{ press: "Escape" }, { press: "ControlOrMeta+K" }, { type: s(locale, "settings.title") }, { clear: true }, { press: "Enter" }], expect: [s(locale, "settings.search")] },
    { id: 7, title: "Escape closes Settings and focus returns to the note", actions: [{ press: "Escape" }], expect: [[editor, HEADING[locale]]] },
    { id: 8, title: "WYSIWYG: the editor has a name", actions: [{ press: "ControlOrMeta+4" }, { focus: ".ProseMirror" }], expect: [s(locale, "editor.wysiwygAriaLabel")] },
    { id: 9, title: "a link: [[ offers the other note", actions: [{ press: "ControlOrMeta+End" }, { press: "Enter" }, { type: `[[${LINK_QUERY[locale]}` }], expect: [note] },
    { id: 10, title: "export: the palette offers HTML export", actions: [{ press: "Escape" }, { press: "ControlOrMeta+K" }, { type: "HTML" }], expect: [s(locale, "cmd.file.exportHtml")] },
  ];
}

/** Which expected phrases were not spoken (empty = the step passed): journey.ts's matching. */
export function missingIn(task: ProductTask, spoken: string[]): string[] {
  return missing({ id: task.id, title: task.title, expect: task.expect }, spoken);
}

/** The receipt of one run: the setup, the voice, and every step's spoken log. */
export interface ProductReceipt {
  setup: string;
  journey: "product";
  locale: JourneyLocale;
  voice: string | null;
  row: string;
  results: Array<{ id: number; title: string; spoken: string[]; missing: string[] }>;
}

/** Whether a spoken log is in the expected language: any Hebrew letter for he, no Hebrew needed for en. */
export function spokeHebrew(spoken: string[]): boolean {
  return /[֐-׿]/.test(normalizeSpoken(spoken.join(" ")));
}
