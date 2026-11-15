/**
 * Review Z6-H1 and Z6-M4 (#929, plan 2.39): the /regex/ time limit.
 *
 *   - H1: it is armed from the parse that runs the regex, for every way the
 *     query grammar (src/search/queryOps.ts TOKEN) can write one;
 *   - M4: it counts from when the worker starts matching the regex, not
 *     while the query waits behind other requests;
 *   - M4: a worker restart does not drop the other callers' requests: each
 *     runs again on the new worker, or rejects with IndexRestartedError;
 *   - the in-thread engine (no worker) keeps the same budget between notes.
 *
 * The workers are fakes over the real protocol and core
 * (../helpers/slowIndexWorker.ts); the budgets are the shipped ones.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseQuery, REGEX_MAX_CHARS } from "../../search/queryOps";
import { createMemoryBackend, setVaultBackend, type VaultBackend } from "../../storage/vault";
import { writeWorkspaceFile } from "../../storage/workspace";
import { __resetWorkspaceIndex, findBacklinks, REGEX_TIME_LIMIT_MS, restartEngine, searchWorkspace, withEngine, type SearchResult } from "../../storage/workspaceIndex";
import { VaultIndex } from "../../storage/vaultIndexCore";
import { localEngine } from "../../storage/vaultIndexLocal";
import { workerEngine, type IndexEngine } from "../../storage/vaultIndexProtocol";
import { SlowWorker, type SlowOptions } from "../helpers/slowIndexWorker";

/** Every way TOKEN writes a /regex/ (operators, quotes, `-`, flags, separators), none of them after plain whitespace only. */
const VARIANTS = [
  "/(a+)+$/",
  "-/(a+)+$/",
  '"x"/(a+)+$/',
  '""/(a+)+$/',
  '"x"-/(a+)+$/',
  '-"x"/(a+)+$/',
  '"a b"/(a+)+$/su',
  'tag:x "y"/(a|aa)+$/i',
  'path:x "y"/(a+)+$/m',
  '"unclosed /(a+)+$/',
  "word\t/(a+)+$/",
  "word\n/(a+)+$/m",
  "word /(a+)+$/",
  "/x/ /(a+)+$/u",
];

describe("every /regex/ the parser runs arms the time limit (Z6-H1)", () => {
  let previous: VaultBackend | null = null;
  let workers: SlowWorker[] = [];
  beforeEach(async () => {
    previous = setVaultBackend(createMemoryBackend());
    workers = [];
    __resetWorkspaceIndex(() => {
      const w = new SlowWorker({ regexMs: 600 });
      workers.push(w);
      return workerEngine(w);
    });
    await writeWorkspaceFile("a.md", "aaaa x y word");
  });
  afterEach(() => {
    __resetWorkspaceIndex();
    setVaultBackend(previous);
  });

  it.each(VARIANTS)("%j", async (q: string) => {
    const parsed = parseQuery(q);
    expect(parsed.ops.some((o) => o.kind === "regex")).toBe(true);
    expect(parsed.invalid).toEqual([]);
    const infos: Array<Omit<SearchResult, "hits">> = [];
    expect(await searchWorkspace(q, { timeLimitMs: 40, onRegexInfo: (i) => infos.push(i) })).toEqual([]);
    expect(infos).toEqual([{ regexSkipped: 0, regexTimedOut: true }]);
    expect(workers[0].terminated).toBe(true);
  });

  it("a query without a /regex/ is never stopped, however slow the limit", async () => {
    for (const q of ["x", '"x/y/"', "path:a/b/", "a/b/", "/x"]) {
      expect(parseQuery(q).ops.some((o) => o.kind === "regex"), q).toBe(false);
      await searchWorkspace(q, { timeLimitMs: 1 });
    }
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
  });
});

describe("the core says a regex starts exactly when its parse holds one (property, Z6-H1)", () => {
  const parts = ["x", "tag:a", "path:b/", '"p q"', '""', '"', "-", "/a+/", "/(a|b)/i", "/[/", "/x", "y/", "-/z/m", " ", "\t", "\n", " ", "/", '"/a/"'];
  const idx = new VaultIndex();
  idx.upsert({ path: "n.md", name: "n.md", content: "a b x y z", modified: 1 });
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed % n;
  };
  it("over 3000 generated queries", () => {
    for (let k = 0; k < 3000; k++) {
      const q = Array.from({ length: 1 + rand(6) }, () => parts[rand(parts.length)]).join("");
      const p = parseQuery(q);
      let started = 0;
      idx.query(q, {}, { onRegexStart: () => started++ });
      expect(started, JSON.stringify(q)).toBe(!p.invalid.length && p.ops.some((o) => o.kind === "regex") ? 1 : 0);
    }
  });
});

describe("the limit counts the regex, not the queue (Z6-M4)", () => {
  let previous: VaultBackend | null = null;
  let workers: SlowWorker[] = [];
  const start = async (o: SlowOptions[]) => {
    previous = setVaultBackend(createMemoryBackend());
    workers = [];
    __resetWorkspaceIndex(() => {
      const w = new SlowWorker(o[workers.length] ?? {});
      workers.push(w);
      return workerEngine(w);
    });
    await writeWorkspaceFile("a.md", "aaaa needle [[b]]");
    await writeWorkspaceFile("b.md", "plain text");
    await searchWorkspace("warm");
  };
  afterEach(() => {
    __resetWorkspaceIndex();
    setVaultBackend(previous);
  });

  it("a cheap /regex/ queued behind a slow request answers, and the worker is not restarted", async () => {
    await start([{ slow: { backlinks: 300 } }]);
    const links = findBacklinks("b.md");
    const infos: Array<Omit<SearchResult, "hits">> = [];
    const hits = await searchWorkspace("/needle/", { timeLimitMs: 100, onRegexInfo: (i) => infos.push(i) });
    expect(hits.map((h) => h.path)).toEqual(["a.md"]);
    expect(infos).toEqual([{ regexSkipped: 0 }]);
    expect((await links).map((h) => h.fromPath)).toEqual(["a.md"]);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
  });

  it("the shipped limit is still 3 s and the size cap 500,000 characters", () => {
    expect(REGEX_TIME_LIMIT_MS).toBe(3_000);
    expect(REGEX_MAX_CHARS).toBe(500_000);
  });
});

describe("a restart keeps the other callers' requests (Z6-M4)", () => {
  let previous: VaultBackend | null = null;
  let workers: SlowWorker[] = [];
  beforeEach(async () => {
    previous = setVaultBackend(createMemoryBackend());
    workers = [];
    // The first worker never finishes a regex; the one started after it answers everything.
    __resetWorkspaceIndex(() => {
      const w = new SlowWorker(workers.length === 0 ? { hang: true } : {});
      workers.push(w);
      return workerEngine(w);
    });
    await writeWorkspaceFile("a.md", "aaaa needle [[b]]");
    await writeWorkspaceFile("b.md", "plain text");
    await searchWorkspace("warm");
  });
  afterEach(() => {
    __resetWorkspaceIndex();
    setVaultBackend(previous);
  });

  it("a request queued behind a runaway regex runs again on the new worker", async () => {
    const infos: Array<Omit<SearchResult, "hits">> = [];
    const runaway = searchWorkspace("/(a+)+$/", { timeLimitMs: 50, onRegexInfo: (i) => infos.push(i) });
    await new Promise((r) => setTimeout(r, 10));
    // Posted to the stuck worker, behind the regex.
    const links = findBacklinks("b.md");
    expect(await runaway).toEqual([]);
    expect(infos).toEqual([{ regexSkipped: 0, regexTimedOut: true }]);
    expect((await links).map((h) => h.fromPath)).toEqual(["a.md"]);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].answered).toContain("backlinks");
  });

  it("a stopped worker rejects what it had not answered with IndexRestartedError, not a bare 'stopped'", async () => {
    const w = new SlowWorker({ hang: true });
    const e = workerEngine(w);
    const pending = e.query("/(a+)+$/", { limit: 5 });
    const behind = e.backlinks("b.md");
    e.dispose("restarted");
    for (const p of [pending, behind]) await expect(p).rejects.toMatchObject({ name: "IndexRestartedError", message: expect.stringMatching(/restarted/) });
  });

  it("a request hit by a second restart rejects with that error (it is run again once, not forever)", async () => {
    const ran: IndexEngine[] = [];
    const err = await withEngine(async (e: IndexEngine, current?: Promise<IndexEngine>) => {
      ran.push(e);
      await restartEngine(current as Promise<IndexEngine>, e);
      throw Object.assign(new Error("the search index was restarted"), { name: "IndexRestartedError" });
    }).catch((x: unknown) => x as Error);
    // Run again once, on the restarted worker (not on an in-thread fallback), then rejected with the error.
    expect(ran.map((e) => e.kind)).toEqual(["worker", "worker"]);
    expect(ran[0]).not.toBe(ran[1]);
    expect(workers).toHaveLength(3);
    expect(err).toMatchObject({ name: "IndexRestartedError" });
  });
});

describe("the in-thread engine keeps the budget (no worker to stop)", () => {
  it("a /regex/ past the limit between notes stops with regexTimedOut, whatever the syntax", async () => {
    let t = 0;
    const e = localEngine(new VaultIndex(), { now: () => (t += 1_000) });
    await e.upsert(Array.from({ length: 20 }, (_, i) => ({ path: `n${i}.md`, name: `n${i}.md`, content: "aaaa x", modified: i })));
    for (const q of VARIANTS) expect(await e.query(q, {}, { regexTimeLimitMs: REGEX_TIME_LIMIT_MS }), q).toMatchObject({ hits: [], regexTimedOut: true });
    // Without a /regex/ there is nothing to stop.
    expect((await e.query("x", {}, { regexTimeLimitMs: REGEX_TIME_LIMIT_MS })).hits).toHaveLength(20);
  });
});
