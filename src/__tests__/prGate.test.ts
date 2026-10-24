/**
 * Plan 0.19: the rules of the Danger PR gate (scripts/lib/prGate.mjs).
 * The acceptance line "a PR that adds an unregistered fetch fails" is the
 * first describe block; a `danger local` run against a real diff is in
 * the PR description.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addedLinesFromDiff,
  licenceChanges,
  sizeLimitReport,
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

  it("renders the size-limit table and names the chunks over their limit", () => {
    const r = sizeLimitReport([
      { name: "app", size: 190 * 1024, sizeLimit: 195 * 1024, passed: true },
      { name: "vendor: react", size: 170 * 1024, sizeLimit: 160 * 1024, passed: false },
    ]);
    expect(r.over).toEqual(["vendor: react"]);
    expect(r.markdown).toContain("| ❌ | vendor: react | 170.0 KB | 160.0 KB |");
  });
});
