import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";

/**
 * Plan W6.36 — a large encrypted vault opens again fast, in the running app.
 * The port of scripts/perf/encrypted-vault-open.harness.ts (which ran only in
 * a lane's scratch Chromium harness) to the e2e suite, against the dev server
 * or the production build (PLAYWRIGHT_BASE_URL):
 *
 *  1. 10,000 notes (Hebrew and English, with links) are written to OPFS;
 *  2. encryption at rest is turned on in the Vault encryption dialog, the
 *     index is built and its sealed snapshot written (as the idle timer
 *     would, through the e2e probe);
 *  3. the page reloads and the vault is unlocked; from the moment the
 *     unlock dialog closes to the first search that finds the last note:
 *     < 2 s (the acceptance; the passphrase KDF before it is W4.20's), and
 *     the index came from the snapshot (10,000 from it, 0 read);
 *  4. one note edited, then the app closed: the next open finds its new
 *     text on the first search (at most that note read, the rest from the
 *     snapshot);
 *  5. no note's text is in IndexedDB in the clear (every database, every
 *     store, every value scanned for each note's unique word).
 *
 * @nightly: the "perf" project runs it (10,000 notes take minutes to
 * write and encrypt). LUMEN_REOPEN_NOTES runs a smaller vault; the 2 s
 * budget is asserted at 10,000.
 */

const NOTES = Number(process.env.LUMEN_REOPEN_NOTES ?? 10_000);
const PASS = "correct horse battery staple reopen";
const BUDGET_MS = 2000;

interface Probe {
  ensureIndex(force?: boolean): Promise<void>;
  searchWorkspace(query: string, opts?: { limit?: number }): Promise<{ path: string }[]>;
  saveSnapshotNow(): Promise<void>;
  snapshotCounters: { fromSnapshot: number; read: number };
  writeWorkspaceFile(path: string, content: string): Promise<void>;
}

function report(name: string, value: number, unit = "ms"): void {
  test.info().annotations.push({ type: "perf", description: `${name}: ${Math.round(value * 10) / 10} ${unit}` });
}

const notePath = (i: number) => `f${i % 100}/note-${i}.md`;

/** The harness's notes: 150–450 words, Hebrew two in three, three links, an embed every 50, and a unique word. */
async function seed(page: Page, n: number): Promise<boolean> {
  return page.evaluate(async (count) => {
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle("__probe", { create: true });
      const ok = typeof (fh as unknown as { createWritable?: unknown }).createWritable === "function";
      await root.removeEntry("__probe");
      if (!ok) return false;
      const HE = "שלום עולם הבית הגדול ספר מחברת ירושלים תל אביב פגישה מחר בבוקר רשימת משימות סיכום הרצאה מבחן".split(" ");
      const EN = "the quick brown fox project meeting notes summary lumen editor markdown vault search index graph".split(" ");
      let s = 7;
      const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const text = (i: number) => {
        const W = i % 3 !== 0 ? HE : EN;
        const words: string[] = [];
        const len = 150 + Math.floor(rnd() * 300);
        for (let k = 0; k < len; k++) words.push(W[Math.floor(rnd() * W.length)]);
        for (let k = 0; k < 3; k++) words.push(`[[note-${Math.floor(rnd() * count)}]]`);
        if (i % 50 === 0) words.push(`![[note-${(i + 1) % count}]]`);
        return `# Note ${i}\n\n${words.join(" ")} unique${i}\n`;
      };
      const dirs = new Map<number, FileSystemDirectoryHandle>();
      const write = async (i: number) => {
        let dir = dirs.get(i % 100);
        if (!dir) dirs.set(i % 100, (dir = await root.getDirectoryHandle(`f${i % 100}`, { create: true })));
        const w = await (await dir.getFileHandle(`note-${i}.md`, { create: true }) as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
        await w.write(text(i));
        await w.close();
      };
      for (let i = 0; i < count; i += 250) await Promise.all(Array.from({ length: Math.min(250, count - i) }, (_, k) => write(i + k)));
      return true;
    } catch {
      return false;
    }
  }, n);
}

async function runCommand(page: Page, name: string) {
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator('[role="dialog"][aria-modal="true"]').filter({ has: page.locator("input") });
  await palette.waitFor({ timeout: 8000 });
  await palette.locator("input").first().fill(name);
  await expect(palette.locator('[role="option"][aria-selected="true"]')).toContainText(name, { timeout: 8000 });
  await page.keyboard.press("Enter");
}

const probe = (page: Page) => page.evaluateHandle(() => (window as unknown as { __lumen: { vaultIndex(): Promise<Probe> } }).__lumen.vaultIndex());

/** Unlock after a reload; returns the time from the dialog closing to the first search that finds `word`, and how the index was filled. */
async function reopen(page: Page, word: string): Promise<{ ms: number; hits: string[]; counters: { fromSnapshot: number; read: number } }> {
  await page.reload();
  const lock = page.getByTestId("vault-unlock");
  await expect(lock).toBeVisible({ timeout: 30_000 });
  await lock.getByLabel("Passphrase").fill(PASS);
  await lock.getByRole("button", { name: "Unlock" }).click();
  await expect(lock).toBeHidden({ timeout: 60_000 });
  const p = await probe(page);
  return p.evaluate(async (pr, w) => {
    const t0 = performance.now();
    await pr.ensureIndex();
    const hits = await pr.searchWorkspace(w, { limit: 5 });
    return { ms: performance.now() - t0, hits: hits.map((h) => h.path), counters: { ...pr.snapshotCounters } };
  }, word);
}

/** Every value of every IndexedDB store of the origin, as text (bytes decoded as UTF-8), searched for `needles`. */
async function plaintextInIndexedDb(page: Page, needles: string[]): Promise<string[]> {
  return page.evaluate(async (words) => {
    const found = new Set<string>();
    const dec = new TextDecoder("utf-8", { fatal: false });
    const visit = (v: unknown, depth = 0): void => {
      if (depth > 6 || v === null || v === undefined) return;
      let s = "";
      if (typeof v === "string") s = v;
      else if (v instanceof ArrayBuffer) s = dec.decode(new Uint8Array(v));
      else if (ArrayBuffer.isView(v)) s = dec.decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      else if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
      else if (v instanceof Map) return v.forEach((x, k) => (visit(k, depth + 1), visit(x, depth + 1)));
      else if (typeof v === "object") return Object.values(v as Record<string, unknown>).forEach((x) => visit(x, depth + 1));
      for (const w of words) if (s.includes(w)) found.add(w);
    };
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of [...db.objectStoreNames]) {
        const all = await new Promise<{ keys: IDBValidKey[]; values: unknown[] }>((res, rej) => {
          const tx = db.transaction(store, "readonly");
          const os = tx.objectStore(store);
          const k = os.getAllKeys();
          const v = os.getAll();
          tx.oncomplete = () => res({ keys: k.result, values: v.result });
          tx.onerror = () => rej(tx.error);
        });
        all.keys.forEach((x) => visit(x));
        all.values.forEach((x) => visit(x));
      }
      db.close();
    }
    return [...found];
  }, needles);
}

test("encrypted vault: 10,000 notes reopen from the sealed snapshot, first search < 2 s after unlock, no plaintext in IndexedDB", { tag: "@nightly" }, async ({ page, browserName }) => {
  test.setTimeout(1_800_000);
  await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });
  vaultOrSkip(await seed(page, NOTES), browserName);
  await page.reload();
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });

  // Encryption at rest, through the dialog (as e2e/vault-encryption.spec.ts).
  await runCommand(page, "Vault encryption");
  const dialog = page.getByTestId("vault-encryption");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Passphrase", { exact: true }).fill(PASS);
  await dialog.getByLabel("Repeat the passphrase").fill(PASS);
  await dialog.getByRole("button", { name: "Turn on encryption" }).click();
  await expect(dialog.getByTestId("vault-recovery-key")).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("I have saved the recovery key").check();
  const encT0 = Date.now();
  await dialog.getByRole("button", { name: "Encrypt the vault" }).click();
  await expect(dialog.getByTestId("vault-enc-done")).toBeVisible({ timeout: 1_200_000 });
  report(`encrypt ${NOTES} notes`, Date.now() - encT0);
  await page.keyboard.press("Escape");

  // The index, then its sealed snapshot (the idle timer's save, now).
  const built = await (await probe(page)).evaluate(async (pr) => {
    const t0 = performance.now();
    await pr.ensureIndex(true);
    await pr.saveSnapshotNow();
    return performance.now() - t0;
  });
  report(`index + sealed snapshot of ${NOTES} notes`, built);

  // Reopen: the snapshot fills the index; the last note is found on the first search.
  const last = NOTES - 1;
  const a = await reopen(page, `unique${last}`);
  report(`reopen: unlock closed → first search (${NOTES} notes)`, a.ms);
  expect(a.hits).toContain(notePath(last));
  expect(a.counters).toEqual({ fromSnapshot: NOTES, read: 0 });
  if (NOTES >= 10_000) expect(a.ms).toBeLessThan(BUDGET_MS);

  // One note edited, then the app closed: the first search of the next open finds its new text. Whether
  // the idle timer saved a snapshot with the edit before the reload decides if it is read again (1) or not (0).
  await (await probe(page)).evaluate((pr, path) => pr.writeWorkspaceFile(path, "# Note 17\n\nedited while closed\n"), notePath(17));
  const b = await reopen(page, "edited while closed");
  report("reopen after an edit: first search", b.ms);
  expect(b.hits[0]).toBe(notePath(17));
  expect(b.counters.read).toBeLessThanOrEqual(1);
  expect(b.counters.fromSnapshot + b.counters.read).toBe(NOTES);
  if (NOTES >= 10_000) expect(b.ms).toBeLessThan(BUDGET_MS);

  // At rest: no note's unique word, Hebrew or English, in any IndexedDB value.
  const sample = [0, 1, 2, 3, 17, Math.floor(NOTES / 2), last].map((i) => `unique${i}`).concat(["edited while closed", "ירושלים תל אביב"]);
  expect(await plaintextInIndexedDb(page, sample)).toEqual([]);
});
