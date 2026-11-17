/**
 * Plan W13.G11 — the entity graph without the picture, under a real screen
 * reader (Guidepup): six steps in Hebrew. The vault (SYNTHETIC) is three
 * generations of one family with a place; the journey opens the entity
 * graph from ⌘K, switches it to the list, hears the summary sentence, the
 * current node, a neighbour, moves there and comes back.
 *
 *   npm run test:sr -- graph --project=voiceover   # on a Mac, VoiceOver with a Hebrew voice
 */
import type { Page } from "@playwright/test";

export interface GraphStep {
  id: number;
  title: string;
  /** Keys pressed, or text typed (`type:`), or a focus (`focus:` a selector). */
  actions: string[];
  /** Phrases the reader must speak; an inner array means "one of these". */
  expect: Array<string | string[]>;
}

const person = (name: string, extra = "") => ({ path: `ישויות/אנשים/${name}.md`, content: `---\ntype: person\nentity-type: person\n${extra}---\n\n# ${name}\n` });
const id = (n: string) => `person:${n.replace(/\s+/g, "-")}`;
const prov = { note: "יומן/משפחה.md", anchor: "p1", quote: "אברהם ושרה", paragraphHash: `sha256:${"0".repeat(64)}`, extractor: "user", model: null, date: "2026-11-01T00:00:00Z" };
const edge = (s: string, p: string, o: string) => JSON.stringify({ id: `${s}|${p}|${o}`, subject: s, predicate: p, object: o, provenance: prov, confidence: 1, status: "approved" });

export const GRAPH_VAULT: Array<{ path: string; content: string }> = [
  person("אברהם"),
  person("שרה"),
  person("יצחק"),
  person("רבקה"),
  person("יעקב"),
  { path: "ישויות/מקומות/חברון.md", content: "---\ntype: place\nentity-type: place\n---\n\n# חברון\n" },
  { path: "יומן/משפחה.md", content: "אברהם ושרה. ^p1\n" },
  {
    path: ".lumen/entities/edges.jsonl",
    content: [
      edge(id("אברהם"), "spouse", id("שרה")),
      edge(id("אברהם"), "child", id("יצחק")),
      edge(id("שרה"), "child", id("יצחק")),
      edge(id("יצחק"), "spouse", id("רבקה")),
      edge(id("יצחק"), "child", id("יעקב")),
      edge(id("יצחק"), "born_in", "place:חברון"),
    ].join("\n") + "\n",
  },
];

export const GRAPH_STEPS: GraphStep[] = [
  { id: 1, title: "פלטת הפקודות: ״גרף ישויות״ נפתח", actions: ["Control+k", "type:גרף ישויות", "Enter"], expect: ["גרף ישויות"] },
  { id: 2, title: "מצב ״רשימה״ נבחר מתוך התצוגות", actions: ["focus:[data-testid=entity-graph-mode]", "type:רשימה"], expect: [["רשימה", "צומת אחר צומת"]] },
  { id: 3, title: "סיכום הגרף נקרא (aria-live)", actions: [], expect: ["6 צמתים", "6 קשרים"] },
  { id: 4, title: "הצומת הנוכחי: המחובר ביותר", actions: ["focus:[data-testid=graph-list-current]"], expect: ["יצחק", ["כותרת", "heading"]] },
  { id: 5, title: "חץ למטה: השכן הראשון וקבוצת היחס שלו", actions: ["focus:[data-testid=graph-list] button[data-neighbour]"], expect: ["חברון"] },
  { id: 6, title: "Enter עובר לשכן, Backspace חוזר", actions: ["Enter", "Backspace"], expect: ["חברון", "יצחק"] },
];

/** Open the app in Hebrew with the graph vault in OPFS (folders included). */
export async function openGraphVault(page: Page, base: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: "he", mode: "source", showWorkspace: true }, version: 0 }));
  });
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    for (const f of files) {
      const parts = f.path.split("/");
      let dir = root;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      const h = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await (h as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
      await w.write(f.content);
      await w.close();
    }
  }, GRAPH_VAULT);
  await page.reload({ waitUntil: "load" });
  await page.locator("html[dir=rtl]").waitFor();
}

const norm = (s: string) => s.replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();

/** The expected phrases that are not in what was spoken. */
export function missing(step: GraphStep, spoken: readonly string[]): string[] {
  const all = norm(spoken.join(" "));
  return step.expect.filter((e) => !(Array.isArray(e) ? e : [e]).some((x) => all.includes(norm(x)))).map((e) => (Array.isArray(e) ? e.join(" / ") : e));
}
