import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOnRelay, startRelay, stopRelay, type Relay } from "./_relay";

/**
 * Havruta, part 2 (plan W12.H2): two browsers study one passage through a
 * local relay (sync-server/collab-server.mjs, e2e/_relay.ts).
 *
 *  - A opens the study screen on בראשית א:א-ג ("Study with a partner"),
 *    agrees to fetch the text, and copies the invite link;
 *  - B opens the link, agrees to join and to fetch the text itself;
 *  - each side's note on a segment shows on the other side, under that
 *    segment ("theirs"); a note that copies the passage is refused;
 *  - the partner's position travels in the presence: when A moves to a
 *    segment, B's copy of that segment is marked;
 *  - the relay holds only ciphertext: no note, no name and no word of the
 *    passage is in its storage.
 *
 * Sefaria is routed to a stand-in (SYNTHETIC text in the API's v3 shape),
 * so the run needs no network. Both sides fetch the text on their own; it
 * never travels through the room.
 */

// skip-reason: the relay listens on the one port the e2e CSP names, so the three engine projects cannot share it at once; the flow is the relay's and Chromium runs it | task: W12.H2 | until: 2027-05-17
test.skip(({ browserName }) => browserName !== "chromium", "one relay port for the e2e CSP: Chromium runs the relay round trip");

const SEGMENTS = ["בראשית ברא אלהים את השמים ואת הארץ", "והארץ היתה תהו ובהו וחשך על פני תהום ורוח אלהים מרחפת על פני המים", "ויאמר אלהים יהי אור ויהי אור"];
const PASSAGE = { ref: "Genesis 1:1-3", heRef: "בראשית א:א-ג", versions: [{ language: "he", actualLanguage: "he", direction: "rtl", versionTitle: "Synthetic test text", versionSource: "https://example.org", license: "CC0", isSource: true, text: SEGMENTS }] };

async function routeSefaria(page: Page, seen: string[]): Promise<void> {
  await page.route(/sefaria\.org/, (route) => {
    seen.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PASSAGE) });
  });
}

/** Every file of the relay's storage, as one string (latin1: bytes as they are). */
function relayBytes(dir: string): string {
  let out = "";
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out += readFileSync(p).toString("latin1") + readFileSync(p).toString("utf8");
    }
  };
  walk(dir);
  return out;
}

let relay: Relay | null = null;
let dataDir = "";

test.beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "lumen-havruta-e2e-"));
});
test.afterEach(async () => {
  if (relay) await stopRelay(relay);
  relay = null;
  rmSync(dataDir, { recursive: true, force: true });
});

test("two partners share notes and position on one passage through the relay, which sees only ciphertext", async ({ browser }) => {
  test.setTimeout(120_000);
  relay = await startRelay(dataDir);
  const noteA = `הערה של א ${Date.now().toString(36)}`;
  const noteB = `הערה של ב ${Date.now().toString(36)}`;

  // A: the study screen on the reference in the note.
  const a = await openOnRelay(browser, relay.url);
  await a.ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const seenA: string[] = [];
  await routeSefaria(a.page, seenA);
  const editor = a.page.locator(".cm-content").first();
  await editor.click();
  await a.page.keyboard.press("ControlOrMeta+a");
  await a.page.keyboard.type("בראשית א:א-ג");
  await a.page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "sources.havruta" } })));
  await a.page.locator(".prompt-btn-ok").click({ timeout: 10_000 }); // fetch the text from Sefaria?
  const screenA = a.page.getByTestId("havruta-screen");
  await expect(screenA).toBeVisible({ timeout: 20_000 });
  await expect(a.page.getByTestId("havruta-seg-2")).toContainText("יהי אור");
  expect(seenA.length).toBeGreaterThan(0);
  await a.page.getByRole("button", { name: "Copy invite link" }).click();
  const link = await a.page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#havruta=havruta-[0-9a-f]{32}&password=/);
  expect(link).not.toContain("Genesis"); // the reference is in the encrypted room, not the link

  // B: joins from the link and fetches the text itself.
  const b = await openOnRelay(browser, relay.url, link.slice(link.indexOf("/#")));
  const seenB: string[] = [];
  await routeSefaria(b.page, seenB);
  await b.page.locator(".prompt-btn-ok").click({ timeout: 15_000 }); // join the study room?
  await b.page.locator(".prompt-btn-ok").click({ timeout: 20_000 }); // fetch the text?
  await expect(b.page.getByTestId("havruta-screen")).toBeVisible({ timeout: 20_000 });
  await expect(b.page.getByTestId("havruta-seg-0")).toContainText("בראשית ברא");
  expect(seenB.length).toBeGreaterThan(0);

  // A note on segment 2 (index 1) from A shows under B's segment 2, and back.
  await a.page.getByTestId("havruta-seg-1").focus();
  await a.page.getByTestId("havruta-note").fill(noteA);
  await a.page.getByTestId("havruta-add").click();
  await expect(a.page.getByTestId("havruta-mine-1")).toContainText(noteA);
  await expect(b.page.getByTestId("havruta-theirs-1")).toContainText(noteA, { timeout: 20_000 });
  await b.page.getByTestId("havruta-seg-0").focus();
  await b.page.getByTestId("havruta-note").fill(noteB);
  await b.page.getByTestId("havruta-add").click();
  await expect(a.page.getByTestId("havruta-theirs-0")).toContainText(noteB, { timeout: 20_000 });

  // Copying the passage into a note is refused (the text never goes through the room).
  await a.page.getByTestId("havruta-note").fill(`ציטוט: ${SEGMENTS[1]}`);
  await a.page.getByTestId("havruta-add").click();
  await expect(b.page.getByTestId("havruta-theirs-1")).not.toContainText("תהו ובהו", { timeout: 3_000 });

  // Presence: A moves to segment 3; B sees the partner there.
  await a.page.getByTestId("havruta-seg-2").focus();
  await expect(b.page.getByTestId("havruta-seg-2")).toHaveAttribute("data-partner-here", "1", { timeout: 20_000 });
  await expect(b.page.getByTestId("havruta-partner")).not.toHaveText("Your partner isn't here yet");

  // The relay's storage: ciphertext only.
  await new Promise((r) => setTimeout(r, 500)); // the relay's debounce (100 ms) has written the room
  const stored = relayBytes(dataDir);
  expect(stored.length).toBeGreaterThan(0);
  for (const plain of [noteA, noteB, "תהו", "בראשית", "Genesis"]) expect(stored.includes(plain), plain).toBe(false);

  await a.ctx.close();
  await b.ctx.close();
});
