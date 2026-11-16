/**
 * Plan 0.19: the rules of the PR gate, `npm run pr:check` (scripts/lib/prGate.mjs).
 * The acceptance line "a PR that adds an unregistered fetch fails" is the
 * first describe block; a `npm run pr:check` run against a real diff is in
 * the PR description.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addedLinesFromDiff,
  handEditedSnapshots,
  isSnapshot,
  licenceChanges,
  skipCiViolations,
  bodyProblems,
  domainMentions,
  REQUIRED_SECTIONS,
  unregisteredNetworkCalls,
  untestedChanges,
  writtenByAi,
  // @ts-expect-error -- plain .mjs script, no types
} from "../../scripts/lib/prGate.mjs";

const LEDGER = readFileSync(join(__dirname, "../ai/privacyLedger.ts"), "utf8");

function diffOf(file: string, lines: string[]): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -1,1 +1,${lines.length + 1} @@`, " const x = 1;", ...lines.map((l) => `+${l}`)].join("\n");
}

describe("network calls must be in the privacy ledger", () => {
  it("fails a new fetch to a host the ledger does not know", () => {
    const added = addedLinesFromDiff(diffOf("src/ai/newThing.ts", ['  const r = await fetch("https://api.example-tracker.io/v1/collect", { method: "POST" });']));
    const v = unregisteredNetworkCalls(added, LEDGER);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file: "src/ai/newThing.ts", line: 2 });
    expect(v[0].why).toMatch(/api\.example-tracker\.io/);
  });

  it("passes a new call to a host the ledger has a rule for, and the local machine", () => {
    const added = addedLinesFromDiff(
      diffOf("src/ai/x.ts", [
        '  await fetch("https://api.anthropic.com/v1/messages", init);',
        '  const ws = new WebSocket("ws://localhost:11434/api");',
      ]),
    );
    expect(unregisteredNetworkCalls(added, LEDGER)).toEqual([]);
  });

  it("asks a call with a computed URL for a `privacy-ledger:` note, on its line or the two above", () => {
    const bare = addedLinesFromDiff(diffOf("src/sync/y.ts", ["  const res = await fetch(url);"]));
    expect(unregisteredNetworkCalls(bare, LEDGER)[0].why).toMatch(/privacy-ledger/);
    const noted = addedLinesFromDiff(diffOf("src/sync/y.ts", ["  // privacy-ledger: research endpoint (atEndpoint, category research)", "  const res = await fetch(url);"]));
    expect(unregisteredNetworkCalls(noted, LEDGER)).toEqual([]);
  });

  it("a block comment that names fetch() is prose, not a call; code after a closed comment still counts (W10.D17)", () => {
    const prose = addedLinesFromDiff(diffOf("src/lib/z.ts", ["/**", " * Can the page `fetch()` this URL?", " *   - `refetch()`: re-fetch on demand", " */", "/* fetch(url) in a one-line comment */"]));
    expect(unregisteredNetworkCalls(prose, LEDGER)).toEqual([]);
    const code = addedLinesFromDiff(diffOf("src/lib/z.ts", ["/* load */ const r = await fetch(url);", "  */ fetch(url);"]));
    expect(unregisteredNetworkCalls(code, LEDGER)).toHaveLength(2);
  });

  it("covers WebSocket, EventSource, XMLHttpRequest, sendBeacon and fetchWithRetry", () => {
    const lines = [
      '  new WebSocket("wss://relay.unknown.net");',
      '  new EventSource("https://events.unknown.net");',
      "  const x = new XMLHttpRequest();",
      '  navigator.sendBeacon("https://beacon.unknown.net", data);',
      '  await fetchWithRetry("https://retry.unknown.net/a");',
    ];
    expect(unregisteredNetworkCalls(addedLinesFromDiff(diffOf("src/lib/z.ts", lines)), LEDGER)).toHaveLength(5);
  });

  it("ignores tests, comments and files outside src/", () => {
    expect(unregisteredNetworkCalls(addedLinesFromDiff(diffOf("src/__tests__/a.test.ts", ['fetch("https://x.unknown.io")'])), LEDGER)).toEqual([]);
    expect(unregisteredNetworkCalls(addedLinesFromDiff(diffOf("scripts/fetch-model.mjs", ['await fetch("https://x.unknown.io")'])), LEDGER)).toEqual([]);
    expect(unregisteredNetworkCalls(addedLinesFromDiff(diffOf("src/a.ts", ['  // we used to fetch("https://x.unknown.io") here'])), LEDGER)).toEqual([]);
  });
});

describe("the other rules", () => {
  it("flags production code changed with no test at all", () => {
    expect(untestedChanges(["src/lib/a.ts", "README.md"])).toEqual(["src/lib/a.ts"]);
    expect(untestedChanges(["src/lib/a.ts", "src/__tests__/a.test.ts"])).toEqual([]);
    expect(untestedChanges(["src/lib/a.ts", "e2e/a.spec.ts"])).toEqual([]);
    expect(untestedChanges(["docs/a.md"])).toEqual([]);
  });

  it("recognises a PR written by an AI agent", () => {
    expect(writtenByAi("", ["fix: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"])).toBe(true);
    expect(writtenByAi("🤖 Generated with [Claude Code](https://claude.com/claude-code)", [])).toBe(true);
    expect(writtenByAi("A human change", ["fix: typo"])).toBe(false);
  });

  it("lists production packages whose licence is new or changed, and fails copyleft and missing ones", () => {
    const base = { packages: { "node_modules/a": { version: "1.0.0", license: "MIT" }, "node_modules/b": { version: "1.0.0", license: "MIT" } } };
    const head = {
      packages: {
        "node_modules/a": { version: "1.0.0", license: "MIT" },
        "node_modules/b": { version: "2.0.0", license: "GPL-3.0-only" },
        "node_modules/c": { version: "1.0.0", license: "Apache-2.0" },
        "node_modules/d": { version: "1.0.0" },
        "node_modules/e": { version: "1.0.0", license: "LGPL-2.1" },
        "node_modules/devtool": { version: "1.0.0", license: "GPL-3.0", dev: true },
      },
    };
    const rows = licenceChanges(base, head);
    expect(rows.map((r: { name: string; level: string }) => `${r.name}:${r.level}`)).toEqual(["b:fail", "c:ok", "d:fail", "e:warn"]);
  });

  it("every commit subject carries [skip ci]", () => {
    expect(skipCiViolations(["feat: a [skip ci]", "fix: b", "docs: c [skip ci]"])).toEqual(["fix: b"]);
  });

  it("the PR body has every required section, none empty", () => {
    const full = REQUIRED_SECTIONS.map((h: string) => `${h}\n\ntext`).join("\n\n");
    expect(bodyProblems(full)).toEqual([]);
    expect(bodyProblems(full.replace("## Not verified here\n\ntext", "## Not verified here\n\n"))).toEqual(['section "## Not verified here" is empty']);
    expect(bodyProblems("## What and why\n\nx")).toContain('missing section "## Owner commands"');
    // A deeper heading inside a section is content, not the next section.
    expect(bodyProblems(full.replace("## Local verification\n\ntext", "## Local verification\n\n### Ran\n- tests"))).toEqual([]);
  });

  it("an added line that names the project's domain is flagged", () => {
    const dom = ["lumen", "md"].join(".");
    const added = addedLinesFromDiff(diffOf("docs/x.md", [`See https://${dom}/docs`, "the file README.md", `src/lumen.mdx`]));
    expect(domainMentions(added).map((m: { line: number }) => m.line)).toEqual([2]);
  });
});

describe("W10.D20: a snapshot changes only with what produces it", () => {
  it("knows vitest's and Playwright's snapshots, and nothing else", () => {
    for (const f of ["src/__tests__/__snapshots__/render/doc-a.html", "src/__tests__/__snapshots__/commandIds.snapshot.json", "src/storage/__snapshots__/x.test.ts.snap", "e2e/visual-smoke.spec.ts-snapshots/mermaid-flowchart-chromium-linux.png"]) expect(isSnapshot(f), f).toBe(true);
    for (const f of ["src/renderer/snapshot.ts", "src/__tests__/renderSnapshot.test.ts", "e2e/visual-smoke.spec.ts", "docs/snapshots.md"]) expect(isSnapshot(f), f).toBe(false);
  });

  it("a vitest snapshot needs a source, test, Markdown input or package change; a Playwright image its spec or the app", () => {
    const doc = "src/__tests__/__snapshots__/render-docs/doc-privacy.html";
    const png = "e2e/visual-smoke.spec.ts-snapshots/mermaid-flowchart-chromium-linux.png";
    expect(handEditedSnapshots([doc])).toEqual([doc]);
    expect(handEditedSnapshots([doc, "docs/other.json", "e2e/visual-smoke.spec.ts"])).toEqual([doc]);
    expect(handEditedSnapshots([doc, "PRIVACY.md"])).toEqual([]);
    expect(handEditedSnapshots([doc, "src/renderer/pipeline.ts"])).toEqual([]);
    expect(handEditedSnapshots([doc, "src/__tests__/renderSnapshotDocs.test.ts"])).toEqual([]);
    expect(handEditedSnapshots([doc, "package-lock.json"])).toEqual([]);
    expect(handEditedSnapshots([png])).toEqual([png]);
    expect(handEditedSnapshots([png, "PRIVACY.md", "src/__tests__/x.test.ts"])).toEqual([png]);
    expect(handEditedSnapshots([png, "e2e/visual-smoke.spec.ts"])).toEqual([]);
    expect(handEditedSnapshots([png, "e2e/other.spec.ts"])).toEqual([png]);
    expect(handEditedSnapshots([png, "src/styles/app.css"])).toEqual([]);
    expect(handEditedSnapshots([png, "public/fonts.css"])).toEqual([]);
    // Two snapshots changing together don't vouch for each other; a deleted one isn't checked.
    expect(handEditedSnapshots([doc, png])).toEqual([doc, png]);
    expect(handEditedSnapshots([doc], () => false)).toEqual([]);
  });
});

describe("W10.D20 (audit r3): each snapshot is produced only by its own test, imports and inputs", () => {
  const ids = "src/__tests__/__snapshots__/commandIds.snapshot.json";
  const render = "src/__tests__/__snapshots__/render/syn-math.html";
  const docs = "src/__tests__/__snapshots__/render-docs/doc-privacy.html";
  const base = "visual/__baselines__/linux/rtl-preview--he-light--tables.png";

  it("the reviewer's repro: a README edit does not vouch for a hand-edited commandIds snapshot", () => {
    expect(handEditedSnapshots(["README.md", ids])).toEqual([ids]);
    expect(handEditedSnapshots(["docs/dev/anything.md", ids])).toEqual([ids]);
    expect(handEditedSnapshots(["src/__tests__/renderSnapshot.test.ts", ids])).toEqual([ids]); // another snapshot's test
    expect(handEditedSnapshots(["src/__tests__/commandIds.test.ts", ids])).toEqual([]);
    expect(handEditedSnapshots(["src/commands/useCommands.ts", ids])).toEqual([]); // in the test's import closure
  });

  it("a rendered snapshot moves with its own input documents, not any Markdown", () => {
    expect(handEditedSnapshots(["PRIVACY.md", docs])).toEqual([]);
    expect(handEditedSnapshots(["README.md", docs])).toEqual([docs]);
    expect(handEditedSnapshots(["PRIVACY.md", render])).toEqual([render]); // PRIVACY.md is not in the 50-document set
    expect(handEditedSnapshots(["public/templates/rfc.md", render])).toEqual([]);
    expect(handEditedSnapshots(["src/renderer/pipeline.ts", render])).toEqual([]);
    expect(handEditedSnapshots(["src/i18n/locales/en/cmd.json", render])).toEqual([]); // through import.meta.glob
    expect(handEditedSnapshots(["src/__tests__/commandIds.test.ts", render])).toEqual([render]);
  });

  it("the visual/ baselines are snapshots too: their specs, the harness or the app produce them", () => {
    expect(isSnapshot(base)).toBe(true);
    expect(handEditedSnapshots([base])).toEqual([base]);
    expect(handEditedSnapshots(["README.md", base])).toEqual([base]);
    expect(handEditedSnapshots(["src/__tests__/x.test.ts", base])).toEqual([base]);
    expect(handEditedSnapshots(["visual/rtl.visual.ts", base])).toEqual([]);
    expect(handEditedSnapshots(["playwright.visual.config.ts", base])).toEqual([]);
    expect(handEditedSnapshots(["src/styles/app.css", base])).toEqual([]);
  });

  it("a .snap beside its test is produced by that test's closure; an unknown snapshot only by the packages", () => {
    const read = (f: string) => ({ "src/a/__tests__/x.test.ts": 'import { f } from "../f";', "src/a/f.ts": "export const f = 1;" })[f] ?? null;
    const snap = "src/a/__tests__/__snapshots__/x.test.ts.snap";
    expect(handEditedSnapshots(["src/a/f.ts", snap], () => true, { read })).toEqual([]);
    expect(handEditedSnapshots(["src/a/g.ts", snap], () => true, { read })).toEqual([snap]);
    const odd = "src/b/__snapshots__/mystery.json";
    expect(handEditedSnapshots(["src/b/index.ts", odd], () => true, { read })).toEqual([odd]);
    expect(handEditedSnapshots(["package-lock.json", odd], () => true, { read })).toEqual([]);
  });
});
