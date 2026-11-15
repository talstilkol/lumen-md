// @vitest-environment node
/**
 * Review Z7-L2 (#938): the entity scan's memory of scanned paragraphs was one per session. Opening another vault
 * with the same note paths and paragraphs got no proposals, and paragraphs scanned by the rules alone were never
 * scanned by a NER model cached later. The memory is now per vault and per extractor.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setVaultBackend } from "../../storage/vault";
import { createMemoryBackend } from "../../storage/vault/memory";
import type { VaultBackend } from "../../storage/vault/types";
import { rememberScanned, resetScan, scanNotes, type ExtractRun } from "../../entities/extract/scanVault";
import type { ExtractReply, ExtractRequest } from "../../entities/extract/protocol";

const FILES = new Map([["a.md", "דוד בן-גוריון נאם בכנסת.\n"]]);
let previous: VaultBackend | null = null;
beforeEach(() => {
  resetScan();
  previous = setVaultBackend(createMemoryBackend());
});
afterEach(() => {
  setVaultBackend(previous);
});

/** A stand-in extractor: every paragraph not in `seen` is "scanned" (hash = the note's path). */
function extractor(mode: () => ExtractReply["mode"]) {
  const calls: Array<Omit<ExtractRequest, "id">> = [];
  const run: ExtractRun = async (req) => {
    calls.push(req);
    const fresh = req.notes.filter((n) => !(req.seen?.[n.path] ?? []).includes("p1"));
    return { id: 0, mode: mode(), proposals: [], seen: Object.fromEntries(fresh.map((n) => [n.path, ["p1"]])), paragraphs: { scanned: fresh.length, skipped: req.notes.length - fresh.length } };
  };
  return { run, calls };
}

describe("Z7-L2: scanned paragraphs are remembered per vault and per extractor", () => {
  it("the same vault skips what it scanned; a switched vault scans everything", async () => {
    const x = extractor(() => "rules+ner");
    rememberScanned(await scanNotes(FILES, [], x.run));
    expect(x.calls[0].seen).toEqual({});
    rememberScanned(await scanNotes(FILES, [], x.run));
    expect(x.calls[1].seen).toEqual({ "a.md": ["p1"] });
    // Another vault (a copy with the same paths and paragraphs) is opened.
    setVaultBackend(createMemoryBackend());
    await scanNotes(FILES, [], x.run);
    expect(x.calls[2].seen).toEqual({});
  });

  it("paragraphs the rules alone scanned are scanned again once a model is cached", async () => {
    let mode: ExtractReply["mode"] = "rules-only";
    const x = extractor(() => mode);
    rememberScanned(await scanNotes(FILES, [], x.run));
    mode = "rules+ner";
    const r = await scanNotes(FILES, [], x.run);
    // The first try skipped a.md (seen by the rules); the model's run is made with nothing seen.
    expect(x.calls.map((c) => c.seen)).toEqual([{}, { "a.md": ["p1"] }, {}]);
    expect(r.seen).toEqual({ "a.md": ["p1"] });
    rememberScanned(r);
    await scanNotes(FILES, [], x.run);
    expect(x.calls[3].seen).toEqual({ "a.md": ["p1"] }); // and then the model's memory is used
    expect(x.calls).toHaveLength(4);
  });
});
