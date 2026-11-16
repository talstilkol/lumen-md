// @vitest-environment node
/**
 * Audit A3 (round 2): modules that were built and unit-tested but that no
 * part of the app reached. Each is now wired in the way its plan task
 * intends; this test walks the import graph from index.html (the app's
 * page — no test, script or package counts) and fails if any of them falls
 * out again. Where each is reached from is in the comment beside it.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { reachFromPages } from "../../scripts/check-unused-files.mjs";

const ROOT = resolve(__dirname, "..", "..");

const WIRED: Record<string, string> = {
  // W7.14 / W10.C21: tag suggestions, date detection and inbox triage ask generateStructured.
  "src/ai/structured/index.ts": "structured output",
  "src/ai/structured/chromeBuiltin.ts": "structured output (Chrome's built-in tier)",
  // W7.16 / W10.C22: ⌘K "Screenshot to note" and the offer after an image paste.
  "src/ai/screenshotNote.ts": "screenshot to note",
  // W10.C2/C3: Settings → MCP servers; the registry gives the agents the servers' tools.
  "src/agents/mcp/client.ts": "MCP client",
  "src/agents/mcp/tools.ts": "MCP client (agent tools)",
  "src/agents/mcp/servers.ts": "MCP client (server list)",
  "src/agents/mcp/sefariaTools.ts": "MCP client (built-in Sefaria server)",
  // W7.20 / W10.C4–C6: {{calendar}} in the daily note and Settings → Calendar.
  "src/calendar/dailyEvents.ts": "calendar in the daily note",
  "src/calendar/config.ts": "calendar settings",
  "src/calendar/caldav.ts": "CalDAV",
  "src/calendar/taskSync.ts": "CalDAV task sync",
  // W10.C15: the backup panel's WebDAV target uses providerTarget.
  "src/backup/backup.ts": "backup (providerTarget)",
  // W11.I16: the AI doctor's "engine ladder" check.
  "src/agents/executors/ladder.ts": "engine ladder",
  "src/agents/doctorLadder.ts": "engine ladder (doctor check)",
  // W11.I23: ⌘K "Ask an external agent…" on the desktop.
  "src/agents/acp/host.ts": "ACP host",
  "src/agents/acp/agents.ts": "ACP agents",
  // W11.H8/H9: read-aloud asks the public gate before a neural Hebrew voice.
  "src/ai/publicGates.ts": "public gates",
  "src/ai/tts/chatterbox.ts": "Chatterbox voice candidate",
  // W12.E6 / R12.7: an entity in the graph opens its page and its timeline.
  "src/ui/EntityPage.tsx": "entity page",
  "src/ui/EntityPagePanel.tsx": "entity page panel",
  "src/views/timeline/TimelineView.tsx": "timeline",
  // W12.E8: the graph screen's export menu.
  "src/entities/export.ts": "entity graph export",
  // R12.10: ⌘K "Where my notes disagree".
  "src/commands/domains/contradictionsAction.ts": "contradiction finder (palette action)",
  "src/agents/contradictor.ts": "contradiction finder",
  "src/agents/contradictions.ts": "contradiction finder (core)",
};

describe("modules the audit found unreachable are reachable from the app (index.html)", () => {
  const reached: Set<string> = reachFromPages({ root: ROOT });
  for (const [file, what] of Object.entries(WIRED)) {
    it(`${what}: ${file}`, () => {
      expect(reached.has(file)).toBe(true);
    });
  }

  it("the walk itself starts at the app: main.tsx is reached, a test is not", () => {
    expect(reached.has("src/main.tsx")).toBe(true);
    expect(reached.has("src/__tests__/appReachable.test.ts")).toBe(false);
  });
});
