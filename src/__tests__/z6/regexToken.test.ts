/**
 * Review Z6-H1 (the reviewer's repro, made behavioural): a query the parser runs as a /regex/ arms the 3 s time
 * limit, however it is written. At 73388182b8 the main thread decided that from its own copy of the token shape,
 * which needs the /regex/ to start the query or follow whitespace, so `"x"/(a+)+$/` ran in the worker untimed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseQuery } from "../../search/queryOps";
import { createMemoryBackend, setVaultBackend, type VaultBackend } from "../../storage/vault";
import { writeWorkspaceFile } from "../../storage/workspace";
import { __resetWorkspaceIndex, searchWorkspace, type SearchResult } from "../../storage/workspaceIndex";
import { workerEngine } from "../../storage/vaultIndexProtocol";
import { SlowWorker } from "../helpers/slowIndexWorker";

describe("Z6 regex time-limit guard", () => {
  let previous: VaultBackend | null = null;
  let workers: SlowWorker[] = [];
  beforeEach(async () => {
    previous = setVaultBackend(createMemoryBackend());
    workers = [];
    // Every worker's regex "runs" 600 ms: far past the 40 ms limit below.
    __resetWorkspaceIndex(() => {
      const w = new SlowWorker({ regexMs: 600 });
      workers.push(w);
      return workerEngine(w);
    });
    await writeWorkspaceFile("a.md", "aaaa! x y");
  });
  afterEach(() => {
    __resetWorkspaceIndex();
    setVaultBackend(previous);
  });

  for (const q of ['"x"/(a+)+$/', 'tag:x "y"/(a|aa)+$/i']) {
    it(`a query the parser runs as /regex/ arms the timer: ${q}`, async () => {
      expect(parseQuery(q).ops.map((o) => o.kind)).toContain("regex");
      const infos: Array<Omit<SearchResult, "hits">> = [];
      await searchWorkspace(q, { timeLimitMs: 40, onRegexInfo: (i) => infos.push(i) });
      expect(infos[0]?.regexTimedOut).toBe(true);
      expect(workers[0].terminated).toBe(true);
    });
  }
});
