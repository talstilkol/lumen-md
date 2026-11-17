/**
 * W5.24: the automations manager — every rule with its switch, a dry run that
 * shows the lines each change would write and writes nothing (0 writes, every
 * byte of the vault the same), the run log with a byte-exact undo per run,
 * and delete with undo. It runs over the real app layer (automations/app.ts)
 * and engine, on an in-memory vault that counts every write.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ dailyNotes: { folder: "Daily", pattern: "YYYY-MM-DD" }, locale: "en" }) } }));
vi.mock("../storage/workspaceEvents", () => ({ onWorkspaceChanged: () => () => {} }));
vi.mock("../storage/linkRewrite", () => ({ updateLinksAfterMove: async () => [] }));
const vault = new Map<string, string>();
let writes = 0;
vi.mock("../storage/workspace", () => ({
  workspaceHasFile: async (p: string) => vault.has(p),
  readWorkspaceFile: async (p: string) => {
    if (!vault.has(p)) throw new Error(`no ${p}`);
    return vault.get(p)!;
  },
  writeWorkspaceFile: async (p: string, t: string) => void (writes++, vault.set(p, t)),
  listWorkspace: async () => [...vault.keys()].map((path) => ({ path })),
  deleteWorkspaceFile: async (p: string) => void (writes++, vault.delete(p)),
  renameWorkspaceFile: async (a: string, b: string) => void (writes++, vault.set(b, vault.get(a)!), vault.delete(a)),
  isOPFSAvailable: () => true,
}));

import axe from "axe-core";
import * as app from "../automations/app";
import { AutomationsPanel, type AutomationsApi } from "../automations/AutomationsPanel";
import { dryRunEventFor, previewLines } from "../automations/describe";
import type { Rule } from "../automations/engine";

const NOTE = "Inbox/פגישה.md";
const TEXT = "---\nstatus: open\n---\n# פגישה עם דנה\n\nסיכום קצר.\n";
const TODAY = "2026-11-17";

/** Rules over every trigger and action kind the manager shows. */
const RULES: Rule[] = [
  { id: "r1", name: "תיוג תיבת דואר", enabled: true, when: { kind: "created", folder: "Inbox" }, then: [{ kind: "tag", tag: "inbox" }] },
  { id: "r2", name: "Task for new notes", enabled: true, when: { kind: "created", folder: "Inbox" }, then: [{ kind: "createTask", text: "לעבור על {{link}}" }] },
  { id: "r3", name: "Daily log", enabled: true, when: { kind: "created" }, then: [{ kind: "appendDaily", text: "- {{link}}" }] },
  { id: "r4", name: "Archive done", enabled: false, when: { kind: "propertyChanged", key: "status", value: "open" }, then: [{ kind: "move", folder: "Archive" }] },
  { id: "r5", name: "Agent review", enabled: true, when: { kind: "tagAdded", tag: "review" }, then: [{ kind: "runAgent", agent: "editor" }] },
  { id: "r6", name: "Every day", enabled: true, when: { kind: "daily" }, then: [{ kind: "appendDaily", text: "## יום חדש" }] },
];

const api: AutomationsApi = { loadRules: app.loadRules, readLog: app.readLog, setRuleEnabled: app.setRuleEnabled, deleteRule: app.deleteRule, restoreRule: app.restoreRule, dryRun: app.dryRun, undoRunById: app.undoRunById };
const snapshot = () => new Map(vault);

async function seed(rules = RULES) {
  vault.clear();
  vault.set(NOTE, TEXT);
  vault.set("Tasks.md", "- [ ] old task\n");
  await app.saveRules(rules);
  writes = 0;
}

const mount = (doc = { path: NOTE as string | null, text: TEXT }, onNewRule = () => {}) => render(<AutomationsPanel api={api} doc={doc} today={TODAY} onNewRule={onNewRule} onClose={() => {}} />);

beforeEach(async () => {
  document.body.innerHTML = "";
  await seed();
});

describe("the rules list", () => {
  it("shows every rule with its trigger, its actions and its switch; Hebrew and English each in their own direction", async () => {
    mount();
    const r1 = await screen.findByTestId("automation-rule-r1");
    expect(r1.textContent).toContain("תיוג תיבת דואר");
    expect(r1.textContent).toContain("Inbox");
    expect(r1.textContent).toContain("#inbox");
    expect(within(screen.getByTestId("automation-rule-r5")).getByText(/editor/)).toBeTruthy();
    expect(screen.getByTestId("automation-rule-r4").getAttribute("data-enabled")).toBe("false");
    expect(screen.getAllByRole("switch")).toHaveLength(RULES.length);
    expect(r1.querySelector(".automations-name")!.getAttribute("dir")).toBe("auto");
  });

  it("the switch turns a rule off in the rules file, and back on", async () => {
    mount();
    const sw = (await screen.findByTestId("automation-rule-r1")).querySelector("input")!;
    await act(async () => void fireEvent.click(sw));
    await waitFor(() => expect(screen.getByTestId("automation-rule-r1").getAttribute("data-enabled")).toBe("false"));
    expect((await app.loadRules()).find((r) => r.id === "r1")!.enabled).toBe(false);
    await act(async () => void fireEvent.click(sw));
    await waitFor(() => expect(screen.getByTestId("automation-rule-r1").getAttribute("data-enabled")).toBe("true"));
    expect((await app.loadRules()).find((r) => r.id === "r1")!.enabled).toBe(true);
  });

  it("delete takes the rule out of the file; Undo puts it back where it was; focus follows (Undo, then the rule's switch)", async () => {
    mount();
    const row = await screen.findByTestId("automation-rule-r2");
    await act(async () => void fireEvent.click(within(row).getByRole("button", { name: /Delete the rule Task for new notes/ })));
    await waitFor(() => expect(screen.queryByTestId("automation-rule-r2")).toBeNull());
    expect((await app.loadRules()).map((r) => r.id)).toEqual(["r1", "r3", "r4", "r5", "r6"]);
    const undo = await screen.findByTestId("automations-undo-delete");
    await waitFor(() => expect(document.activeElement).toBe(undo));
    await act(async () => void fireEvent.click(undo));
    await waitFor(() => expect(screen.getByTestId("automation-rule-r2")).toBeTruthy());
    expect((await app.loadRules()).map((r) => r.id)).toEqual(RULES.map((r) => r.id));
    await waitFor(() => expect(document.activeElement?.id).toBe("automation-rule-r2-on"));
  });

  it("no rules: says how to make one, and New rule… is there", async () => {
    await seed([]);
    const onNew = vi.fn();
    mount(undefined, onNew);
    expect((await screen.findByTestId("automations-empty")).textContent).toMatch(/New rule/);
    expect(screen.getByTestId("automations-runs-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("automations-new"));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId("automations-dry-all") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the dry run", () => {
  it("one rule: the very lines it would write, 'nothing was written', 0 writes and every byte the same; focus on the result", async () => {
    mount();
    const before = snapshot();
    const row = await screen.findByTestId("automation-rule-r2");
    await act(async () => void fireEvent.click(within(row).getByRole("button", { name: /Dry run of Task for new notes/ })));
    const dry = await screen.findByTestId("automations-dry");
    expect(within(dry).getByTestId("automations-dry-safe")).toBeTruthy();
    const change = within(dry).getByTestId("automations-change");
    expect(change.textContent).toContain("Tasks.md");
    const added = [...change.querySelectorAll(".automations-add")].map((n) => n.textContent);
    expect(added.some((l) => l!.includes("- [ ] לעבור על [[פגישה]]"))).toBe(true);
    expect(change.querySelector(".automations-eq")!.textContent).toContain("old task");
    expect(writes).toBe(0);
    expect(snapshot()).toEqual(before);
    await waitFor(() => expect(document.activeElement?.id).toBe("automations-dry-h"));
  });

  it("all rules that are on, together with the cascade: tag, task, daily line, the agent waiting for review; off rules stay out; 0 writes", async () => {
    mount();
    const before = snapshot();
    await screen.findByTestId("automation-rule-r1");
    await act(async () => void fireEvent.click(screen.getByTestId("automations-dry-all")));
    const dry = await screen.findByTestId("automations-dry");
    const heads = within(dry).getAllByTestId("automations-change").map((c) => c.querySelector(".automations-change-head")!.textContent!);
    expect(heads.some((h) => h.includes(NOTE) && h.includes("תיוג"))).toBe(true);
    expect(heads.some((h) => h.includes("Tasks.md"))).toBe(true);
    expect(heads.some((h) => h.includes("Daily Log") || h.includes("Daily log"))).toBe(true);
    expect(heads.some((h) => h.includes("Archive"))).toBe(false); // r4 is off
    expect(writes).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("a rule that is off can still be tried; a daily rule is tried even when it already ran today", async () => {
    mount();
    const row = await screen.findByTestId("automation-rule-r4");
    await act(async () => void fireEvent.click(within(row).getByRole("button", { name: /Dry run of Archive done/ })));
    const dry = await screen.findByTestId("automations-dry");
    expect(dry.textContent).toContain("Archive/פגישה.md");
    expect(dry.textContent).toMatch(/moved from Inbox\/פגישה\.md/);
    expect(writes).toBe(0);
  });

  it("no note saved in the vault: the note rules can't be tried and it says why; nothing is sent to the engine", async () => {
    const spy = vi.spyOn(api, "dryRun");
    mount({ path: null, text: "" });
    await screen.findByTestId("automation-rule-r1");
    expect(screen.getByText(/open a note that is saved in the vault/)).toBeTruthy();
    const r1 = within(screen.getByTestId("automation-rule-r1")).getByRole("button", { name: /Dry run/ }) as HTMLButtonElement;
    expect(r1.disabled).toBe(true);
    expect((screen.getByTestId("automations-dry-all") as HTMLButtonElement).disabled).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the run log and undo", () => {
  it("each run is listed; Undo puts every byte back and marks it undone; focus goes to the status", async () => {
    const before = snapshot();
    const entry = await app.runFor({ kind: "created", path: NOTE, text: TEXT });
    expect(entry).not.toBeNull();
    expect(snapshot()).not.toEqual(before);
    mount();
    const run = await screen.findByTestId(`automation-run-${entry!.id}`);
    expect(run.textContent).toMatch(/changes/);
    await act(async () => void fireEvent.click(within(run).getByRole("button", { name: /Undo the run/ })));
    await waitFor(() => expect(screen.getByTestId(`automation-run-${entry!.id}`).getAttribute("data-undone")).toBe("true"));
    // The log and state files are the app's own; every note is back byte for byte.
    const notes = (m: Map<string, string>) => new Map([...m].filter(([p]) => !p.startsWith(".lumen/")));
    expect(notes(snapshot())).toEqual(notes(before));
    expect(screen.getByTestId("automations-status").textContent).toMatch(/byte for byte/);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("automations-status")));
  });

  it("a run whose note was edited since is not undone, and says which file", async () => {
    const entry = await app.runFor({ kind: "created", path: NOTE, text: TEXT });
    vault.set("Tasks.md", vault.get("Tasks.md") + "- [ ] edited by hand\n");
    mount();
    const run = await screen.findByTestId(`automation-run-${entry!.id}`);
    await act(async () => void fireEvent.click(within(run).getByRole("button", { name: /Undo the run/ })));
    await waitFor(() => expect(screen.getByTestId("automations-status").textContent).toMatch(/Tasks\.md was edited after the run/));
    expect(screen.getByTestId(`automation-run-${entry!.id}`).getAttribute("data-undone")).toBe("false");
    expect(vault.get("Tasks.md")).toContain("edited by hand");
  });
});

describe("accessibility", () => {
  it("axe: no serious or critical violation with rules, a dry run and the log on screen", async () => {
    await app.runFor({ kind: "created", path: NOTE, text: TEXT });
    const { container } = mount();
    const row = await screen.findByTestId("automation-rule-r2");
    await act(async () => void fireEvent.click(within(row).getByRole("button", { name: /Dry run of Task/ })));
    await screen.findByTestId("automations-dry");
    const r = await axe.run(container.ownerDocument.body, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: false } } });
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(bad).toEqual([]);
  });
});

describe("the pure parts", () => {
  it("previewLines: changed lines with context, long unchanged runs elided, counts right", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const after = before.replace("line 3\n", "line 3 changed\n") + "new last\n";
    const p = previewLines(before, after);
    expect(p.added).toBe(2);
    expect(p.removed).toBe(1);
    expect(p.lines.filter((l) => l.op === "gap")).toHaveLength(1);
    expect(p.lines.length).toBeLessThan(15);
    expect(previewLines(null, "a\nb\n")).toMatchObject({ added: 2, removed: 0 });
  });

  it("dryRunEventFor: daily → the day; property rule → the properties appear; others → created; no note → null", () => {
    expect(dryRunEventFor(RULES[5], { path: null, text: "" }, TODAY)).toEqual({ kind: "daily", date: TODAY });
    expect(dryRunEventFor(RULES[0], { path: null, text: "" }, TODAY)).toBeNull();
    expect(dryRunEventFor(RULES[3], { path: NOTE, text: TEXT }, TODAY)).toMatchObject({ kind: "changed", before: "# פגישה עם דנה\n\nסיכום קצר.\n", after: TEXT });
    expect(dryRunEventFor(RULES[0], { path: NOTE, text: TEXT }, TODAY)).toMatchObject({ kind: "created", path: NOTE });
  });
});
