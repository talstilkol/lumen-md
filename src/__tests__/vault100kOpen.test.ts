/**
 * W2.22 / W10.E17 — the acceptance number itself: a vault of 100,000 notes
 * opens from its stored snapshot in under 2 s (OPEN_LIMIT_MS). This is the
 * open (read, decode, summaries, tree rows), not the build that made the
 * snapshot and not the deferred index fill, the same measure as
 * `npm run perf:vault100k`.
 *
 * The number that counts is the Mac's (the owner's machine). On a shared
 * cloud VM the same run is near the limit; the test prints its phases so a
 * red run says which phase went over.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { measureOpen, OPEN_LIMIT_MS } from "../../scripts/perf/vaultOpen";

const N = 100_000;

/** A synthetic vault (made up for this test): 100,000 notes, 300 folders of 7 sub-folders, Hebrew and English, tags and links. */
function vault() {
  return Array.from({ length: N }, (_, i) => ({
    path: `f${i % 300}/s${i % 7}/note-${i}.md`,
    name: `note-${i}.md`,
    modified: i + 1,
    content: `---\ntags: [t${i % 7}]\n---\n# פתק ${i}\n\nשלום עולם, a note with [[note-${(i * 7) % N}]] #tag${i % 5}\n`,
  }));
}

describe("100,000 notes open in under 2 s (W10.E17)", () => {
  it("opens from the snapshot under OPEN_LIMIT_MS, every note summarized, the tree collapsed", { timeout: 120_000 }, () => {
    const files = vault();
    const r = measureOpen(files, "f7/s0/note-7.md");
    console.log(`vault100k open: ${Math.round(r.openMs)} ms`, JSON.stringify(r.phases), `index (deferred) ${Math.round(r.indexMs)} ms`);
    // Not an empty pass: the whole vault was read and summarized.
    expect(r.notes).toBe(N);
    // 300 top folders collapsed, f7 and f7/s0 open: 300 + 7 sub-folders + the notes of f7/s0.
    expect(r.rows).toBe(300 + 7 + files.filter((f) => f.path.startsWith("f7/s0/")).length);
    expect(OPEN_LIMIT_MS).toBe(2000);
    expect(r.openMs).toBeLessThan(OPEN_LIMIT_MS);
  });
});
