import { test, expect, type Route } from "@playwright/test";
import { freshApp, seed } from "./_wave12";

/**
 * Ask the vault, paragraph citations (plan W12.A1): a question answered by
 * a scripted model on localhost (Ollama's API, routed: no model, no
 * network), whose answer cites one note by its number and a quote from its
 * second paragraph. The citation is checked against that note down to the
 * paragraph (✓ and ¶2), and a click opens the note with the whole cited
 * paragraph selected — not the first line, not another paragraph.
 *
 * The vault is SYNTHETIC, written by the test through the app's index.
 */

const NOTE = "פרויקטים/גשר.md";
const P1 = "הפרויקט התחיל באביב עם צוות קטן של שלושה מהנדסים.";
const P2 = "הגשר החדש ייפתח לתנועה בחודש מרץ, אחרי בדיקת עומסים אחרונה.";
const P3 = "התקציב אושר בוועדה בלי שינויים.";
const OTHER = "יומן/קניות.md";

/** The editor's own selection (CodeMirror state, not the DOM's), through the content node's view. */
function cmSelection(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    type View = { state: { selection: { main: { from: number; to: number } }; sliceDoc(a: number, b: number): string } };
    const el = document.querySelector(".cm-content") as (HTMLElement & { cmTile?: { root?: { view?: View } } }) | null;
    const v = el?.cmTile?.root?.view;
    if (!v) return "";
    const { from, to } = v.state.selection.main;
    return v.state.sliceDoc(from, to);
  });
}

test("a citation's click opens its note with the cited paragraph selected", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const cloud: string[] = [];
  page.on("request", (r) => {
    if (/^https:\/\/(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai)\//.test(r.url())) cloud.push(r.url());
  });
  await page.route(/^http:\/\/(localhost|127\.0\.0\.1):11434\/api\/(tags|version|show)/, (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/tags")) return route.fulfill({ json: { models: [{ name: "qwen2.5:7b", details: { parameter_size: "7.6B", family: "qwen2" } }] } });
    if (path.endsWith("/version")) return route.fulfill({ json: { version: "0.6.0" } });
    return route.fulfill({ json: { capabilities: ["completion"] } });
  });
  let context = "";
  await page.route(/^http:\/\/(localhost|127\.0\.0\.1):11434\/api\/chat/, (route: Route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: string }> };
    context = body.messages.map((m) => m.content).join("\n");
    // The source number the app gave the bridge note ("📄 [n] path").
    const n = new RegExp(`📄 \\[(\\d+)\\] ${NOTE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`).exec(context)?.[1];
    const content = n ? `הגשר ייפתח במרץ [${n}] "הגשר החדש ייפתח לתנועה בחודש מרץ".` : "אין לי מקור.";
    return route.fulfill({ json: { message: { role: "assistant", content }, done: true, prompt_eval_count: 40, eval_count: 12 } });
  });
  await page.addInitScript(() => localStorage.setItem("lumen.ai.policy", "local-only"));

  await freshApp(page, browserName, "he");
  await seed(page, { [NOTE]: `# גשר\n\n${P1}\n\n${P2}\n\n${P3}\n`, [OTHER]: "# קניות\n\nלחם, חלב וגבינה.\n" });

  // The search dialog, opened on its Ask tab (the hook the palette entries use).
  await page.evaluate(() => {
    (window as unknown as { __lumenSearchMode?: string }).__lumenSearchMode = "ai";
    window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.search" } }));
  });
  const dialog = page.getByTestId("search-dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const input = dialog.locator("input").first();
  await input.fill("מתי ייפתח הגשר?");
  await input.press("Enter");

  const cites = page.getByTestId("vault-citations");
  await expect(cites).toBeVisible({ timeout: 30_000 });
  const cite = cites.locator('button[data-verified="1"]').first();
  await expect(cite).toContainText("גשר.md");
  await expect(cite).toContainText("¶2"); // the paragraph, not a line
  expect(context).toContain(P2);

  await cite.click();
  // The note is open and exactly the cited paragraph is selected.
  await expect.poll(() => cmSelection(page), { timeout: 10_000 }).toContain("בחודש מרץ");
  const selected = await cmSelection(page);
  expect(selected.replace(/\s+/g, " ").trim()).toBe(P2);
  expect(selected).not.toContain(P1);
  expect(selected).not.toContain(P3);
  expect(cloud).toEqual([]);
});
