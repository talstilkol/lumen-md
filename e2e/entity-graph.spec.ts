import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { testHooks, type LumenTestWindow } from "./_lumen";
import { opfsWritable, vaultOrSkip } from "./_opfs";
import { entityId, edgeId, type EntityType } from "../src/entities/model";

/**
 * The entity graph in a real browser, in Hebrew (RTL), on the app as it
 * mounts it (plan W12.E5, W12.E7, W12.E2). The vitest files
 * (entityGraphUi, entityReviewWiring, entityGraphHost) cover the same
 * components in happy-dom; these are the acceptance runs the audit found
 * missing: "e2e (20 proposals, byte-identical after undo) and axe never
 * ran", "fps, axe and e2e not run", "10k vault long-task < 50 ms never
 * measured".
 *
 *   W12.E5  20 proposals in the review panel: keyboard select + approve,
 *           the button for the rest, merge, split, then Undo four times; the
 *           vault is byte for byte what it was at every stage. axe clean.
 *   W12.E7  the graph screen in table mode: one relation and the time slider
 *           narrow the table; axe clean.
 *   W12.E2  10,000 notes scanned when the review panel opens: no long task
 *           of 50 ms or more on the main thread (Chromium only: the Long
 *           Tasks API). Tagged @nightly: it runs in the "perf" project.
 *
 * Every vault here is SYNTHETIC, written by the test. OPFS is needed, so the
 * vault flows skip on Linux WebKit only (e2e/_opfs.ts).
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const NOTE = "יומן/א.md";
const TEXT = "דוד כהן נולד בחיפה. ^a1\n\nרחל לוי חברה בוועד השכונה. ^b2\n";
const HASH = `sha256:${"0".repeat(64)}`;
const ENTITY_PREFIXES = ["ישויות/", ".lumen/entities/", NOTE];

const ent = (type: EntityType, name: string) => ({
  kind: "entity",
  id: `p:${entityId(type, name)}`,
  type,
  name,
  aliases: [],
  mentions: [{ note: NOTE, anchor: null, paragraphHash: HASH, start: 0, end: 2, text: name }],
  extractor: "lumen-rules@1",
  model: null,
  confidence: 1,
});
const DAVID = entityId("person", "דוד כהן");
const RACHEL = entityId("person", "רחל לוי");
const HAIFA = entityId("place", "חיפה");
const COMMITTEE = entityId("organization", "ועד השכונה");
const edge = (s: string, p: string, o: string, quote: string, anchor: string) => {
  const id = edgeId(s, p, o, NOTE, anchor);
  return {
    kind: "edge",
    id,
    edge: { id, subject: s, predicate: p, object: o, provenance: { note: NOTE, anchor, quote, paragraphHash: HASH, extractor: "lumen-relations@1", model: "ollama:t", date: "2026-11-15T00:00:00Z" }, confidence: 0.8, status: "proposed" },
  };
};

/** 4 named entities, 14 concepts and 2 relations: 20 proposals, as in entityGraphUi.test.tsx. */
function proposals(): string {
  const rows = [
    ent("person", "דוד כהן"),
    ent("person", "רחל לוי"),
    ent("place", "חיפה"),
    ent("organization", "ועד השכונה"),
    ...Array.from({ length: 14 }, (_, i) => ent("concept", `מושג ${i + 1}`)),
    edge(DAVID, "born_in", HAIFA, "דוד כהן נולד בחיפה", "a1"),
    edge(RACHEL, "member_of", COMMITTEE, "רחל לוי חברה בוועד השכונה", "b2"),
  ];
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

const run = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

async function bootHebrew(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: "he" }, version: 0 }));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await testHooks(page);
}

async function writeFiles(page: Page, files: Record<string, string>): Promise<void> {
  await page.evaluate(async (all) => {
    const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
    for (const [p, text] of Object.entries(all)) await ws.writeWorkspaceFile(p, text);
  }, files);
}

/** The entity graph's files and the note, byte for byte, sorted by path. */
async function snapshot(page: Page): Promise<string> {
  return page.evaluate(async (prefixes) => {
    const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
    const out: Array<[string, string]> = [];
    for (const e of await ws.listWorkspace({ includeHidden: true })) {
      if (!prefixes.some((p) => e.path === p || e.path.startsWith(p))) continue;
      out.push([e.path, await ws.readWorkspaceFile(e.path)]);
    }
    return JSON.stringify(out.sort(([a], [b]) => a.localeCompare(b)));
  }, ENTITY_PREFIXES);
}

/** The snapshot once two reads a second apart agree (the panel's scan may still be writing). */
async function settled(page: Page): Promise<string> {
  let last = await snapshot(page);
  let stable = "";
  await expect
    .poll(
      async () => {
        const now = await snapshot(page);
        const same = now === last;
        last = now;
        if (same) stable = now;
        return same;
      },
      { message: "the entity files kept changing for 20 s after the review panel opened", timeout: 20_000, intervals: [1000] },
    )
    .toBe(true);
  return stable;
}

type Violation = { id: string; impact: string | null; nodes: Array<{ target: string[] }> };
async function axe(page: Page, selector: string): Promise<Violation[]> {
  await page.evaluate(AXE);
  return page.evaluate(async (sel) => {
    const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Violation[] }> } };
    const r = await w.axe.run({ include: [sel] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target })) }));
  }, selector);
}
const blocking = (vs: Violation[]) => vs.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

test.describe("W12.E5 review queue in RTL", () => {
  test("20 proposals; keyboard approve, button approve, merge, split; four Undos restore every stage byte for byte; axe clean", async ({ page, browserName }) => {
    test.setTimeout(120_000);
    await bootHebrew(page);
    vaultOrSkip(await opfsWritable(page), browserName);
    await writeFiles(page, { [NOTE]: TEXT, ".lumen/entities/proposals.jsonl": proposals() });

    await run(page, "entities.review");
    const panel = page.getByTestId("entity-review");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const list = panel.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(20, { timeout: 20_000 });
    expect(blocking(await axe(page, "[data-testid=entity-review]"))).toEqual([]);
    // Opening the panel runs the extraction scan (W12.E2); start from the vault once it has settled.
    const v0 = await settled(page);

    // Keyboard: select the four named entities and approve with A.
    await list.focus();
    for (let i = 0; i < 4; i++) {
      await list.press(" ");
      await list.press("ArrowDown");
    }
    await list.press("a");
    await expect(list.getByRole("option")).toHaveCount(16);
    const v1 = await snapshot(page);
    expect(v1).not.toBe(v0);

    // The rest with the toolbar button.
    for (let i = 0; i < 16; i++) {
      await list.press(" ");
      await list.press("ArrowDown");
    }
    await panel.getByRole("button", { name: /^אישור 16/ }).click();
    await expect(list).toHaveCount(0);
    const v2 = await snapshot(page);

    // Merge מושג 2 into מושג 1.
    const selects = panel.getByRole("combobox");
    await selects.nth(0).selectOption(entityId("concept", "מושג 1"));
    await selects.nth(1).selectOption(entityId("concept", "מושג 2"));
    await panel.getByRole("button", { name: "מיזוג", exact: true }).click();
    await expect.poll(() => snapshot(page)).not.toBe(v2);
    const v3 = await snapshot(page);
    expect(v3).not.toContain("מושג 2.md");

    // Split רחל's membership into a new person.
    await selects.nth(2).selectOption(RACHEL);
    await panel.getByRole("checkbox", { name: /רחל לוי חברה/ }).check();
    await panel.getByRole("textbox").fill("רחל לוי (ועד)");
    await panel.getByRole("button", { name: "פיצול", exact: true }).click();
    await expect.poll(() => snapshot(page)).toContain("רחל לוי (ועד).md");
    expect(blocking(await axe(page, "[data-testid=entity-review]"))).toEqual([]);

    // Undo, one step at a time: back to the exact bytes of every stage.
    for (const before of [v3, v2, v1, v0]) {
      await panel.getByRole("button", { name: "ביטול", exact: true }).click();
      await expect.poll(() => snapshot(page), { timeout: 10_000 }).toBe(before);
    }
  });
});

test.describe("W12.E7 graph screen in RTL", () => {
  test("table mode: one relation and the time slider narrow the same relations; axe clean", async ({ page, browserName }) => {
    test.setTimeout(90_000);
    await bootHebrew(page);
    vaultOrSkip(await opfsWritable(page), browserName);
    const member = { id: `${RACHEL}|member_of|${COMMITTEE}|${NOTE}#^b2`, subject: RACHEL, predicate: "member_of", object: COMMITTEE, provenance: { note: NOTE, anchor: "b2", quote: "רחל לוי חברה בוועד השכונה", paragraphHash: HASH, extractor: "user", model: null, date: "2026-11-15T00:00:00Z" }, confidence: 1, status: "approved" };
    const born = { ...member, id: `${DAVID}|born_in|${HAIFA}|${NOTE}#^a1`, subject: DAVID, predicate: "born_in", object: HAIFA, when: "1950-01-01", provenance: { ...member.provenance, anchor: "a1", quote: "דוד כהן נולד בחיפה" } };
    await writeFiles(page, {
      [NOTE]: `---\ndate: 2026-11-15\ntags: [יומן]\n---\n\n${TEXT}`,
      "ישויות/אנשים/דוד כהן.md": "---\nentity-type: person\n---\n\n# דוד כהן\n",
      "ישויות/אנשים/רחל לוי.md": "---\nentity-type: person\n---\n\n# רחל לוי\n",
      "ישויות/מקומות/חיפה.md": "---\nentity-type: place\n---\n\n# חיפה\n",
      "ישויות/ארגונים/ועד השכונה.md": "---\nentity-type: organization\n---\n\n# ועד השכונה\n",
      ".lumen/entities/edges.jsonl": `${JSON.stringify(member)}\n${JSON.stringify(born)}\n`,
    });

    await run(page, "entities.graph");
    const view = page.getByTestId("entity-graph");
    await expect(view).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("entity-graph-mode").selectOption("table");
    const rows = page.getByTestId("entity-graph-edges").locator("tbody tr");
    await expect(rows).toHaveCount(2, { timeout: 15_000 });

    // One relation only: every relation box but "חבר ב" off.
    await view.locator("summary", { hasText: "קשרים" }).first().click();
    const group = view.getByRole("group", { name: "קשרים" });
    const boxes = group.getByRole("checkbox");
    for (let i = 0; i < (await boxes.count()); i++) {
      const box = boxes.nth(i);
      const text = (await box.locator("xpath=..").textContent()) ?? "";
      if (!text.includes("חבר ב") && (await box.isChecked())) await box.uncheck();
    }
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId("entity-graph-stats")).toContainText("1 קשרים");

    // The time slider at its first day: member_of (2026) is not there yet.
    const slider = page.getByTestId("entity-graph-time");
    await slider.fill("0");
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("entity-graph-stats")).toContainText("0 קשרים");
    expect(blocking(await axe(page, "[data-testid=entity-graph]"))).toEqual([]);
  });
});

test.describe("W12.E2 10,000-note scan off the main thread", () => {
  test("opening the review panel scans 10,000 notes with no long task ≥ 50 ms @nightly", async ({ page, browserName }) => {
    // skip-reason: the Long Tasks API (PerformanceObserver "longtask") exists in Chromium only | task: W12.E2 | until: 2027-05-16
    test.skip(browserName !== "chromium", "the Long Tasks API is Chromium-only");
    test.setTimeout(600_000);
    await bootHebrew(page);
    vaultOrSkip(await opfsWritable(page), browserName);
    // 10,000 notes, one in fifty names a law (the rules extractor finds those without a model).
    await page.evaluate(async () => {
      const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
      const jobs: Promise<unknown>[] = [];
      for (let i = 0; i < 10_000; i++) {
        const law = i % 50 === 0 ? `\n\nלפי חוק הגנת הפרטיות, התשמ״א-1981 (${i}).` : "";
        jobs.push(ws.writeWorkspaceFile(`vault10k/${i % 100}/note-${i}.md`, `# פתק ${i}\n\nשורה של טקסט רגיל בפתק מספר ${i}.${law}\n`));
        if (jobs.length >= 64) await Promise.all(jobs.splice(0));
      }
      await Promise.all(jobs);
    });
    await page.evaluate(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__longTasks.push(e.duration);
      }).observe({ type: "longtask", buffered: false });
    });
    const t0 = Date.now();
    await run(page, "entities.review");
    const panel = page.getByTestId("entity-review");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByRole("listbox").getByRole("option").first()).toBeVisible({ timeout: 540_000 });
    const scanMs = Date.now() - t0;
    const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
    const worst = Math.max(0, ...longTasks);
    test.info().annotations.push({ type: "W12.E2", description: JSON.stringify({ notes: 10_000, scanMs, longTasks: longTasks.length, worstMs: Math.round(worst) }) });
    expect(worst, `long tasks during the scan: ${JSON.stringify(longTasks.map(Math.round))}`).toBeLessThan(50);
  });
});
