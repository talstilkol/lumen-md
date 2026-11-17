/**
 * W12.E5/E6 wiring — the graph proposals in the app: inside the review
 * panel, above the agents' staged changes, over the real workspace (a
 * memory vault behind storage/workspace). Approving writes the entity note
 * through the controlled write path; Undo takes the vault back byte for
 * byte; a file changed underneath is refused and nothing is written.
 * ⌘K has "Entity graph: proposals to review"; the seven entity types are
 * built-in typed-object types (W12.T3), so each has its Base and "All
 * <type>" entry, and an approved note is of its type. axe on the panel.
 * Synthetic vault.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { setVaultBackend } from "../storage/vault";
import { createMemoryBackend } from "../storage/vault/memory";
import type { VaultBackend } from "../storage/vault/types";
import * as workspace from "../storage/workspace";
import { AgentReviewPanel } from "../ui/AgentReviewPanel";
import { buildEntityCommands } from "../commands/domains/entities";
import { buildTypeCommands } from "../commands/typeCommands";
import { loadVaultTypes } from "../types/vaultTypes";
import { noteIsA } from "../types/typeRegistry";
import { typeFilter } from "../types/typeBase";
import { parse as parseYaml } from "yaml";
import { entityId, entityNotePath, ENTITY_TYPES, type EntityType } from "../entities/model";
import { PROPOSALS_PATH, toJsonl, type Proposal } from "../entities/store";
import { approve } from "../entities/review";
import { applyEntityOp, EntityWriteConflict, hasEntityData, loadEntityFiles } from "../entities/vaultIo";
import type { CommandContext } from "../commands/domains/context";

const NOTE = "יומן/א.md";
const TEXT = "דוד כהן נולד בחיפה.\n\nרחל לוי חברה בוועד השכונה.";
const ent = (type: EntityType, name: string): Proposal => ({ kind: "entity", id: `p:${entityId(type, name)}`, type, name, aliases: [], mentions: [{ note: NOTE, anchor: null, paragraphHash: "sha256:" + "0".repeat(64), start: 0, end: name.length, text: name }], extractor: "lumen-rules@1", model: null, confidence: 1 });
const PROPS = [ent("person", "דוד כהן"), ent("person", "רחל לוי"), ent("place", "חיפה")];

let previous: VaultBackend | null = null;
let backend: VaultBackend;

async function seed(withGraph = true) {
  backend = createMemoryBackend();
  previous = setVaultBackend(backend);
  await workspace.writeWorkspaceFile(NOTE, TEXT);
  if (withGraph) await workspace.writeWorkspaceFile(PROPOSALS_PATH, toJsonl(PROPS));
}
async function snapshot(): Promise<string> {
  const entries = await workspace.listWorkspace({ includeHidden: true });
  const out: Array<[string, string]> = [];
  for (const e of entries) out.push([e.path, await workspace.readWorkspaceFile(e.path)]);
  return JSON.stringify(out.sort(([a], [b]) => a.localeCompare(b)));
}
async function axeClean(el: Element) {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

beforeEach(() => {
  document.documentElement.dir = "rtl";
  document.documentElement.lang = "he";
});
afterEach(() => {
  setVaultBackend(previous);
  document.documentElement.dir = "";
});

describe("W12.E5 controlled write path (entities/vaultIo)", () => {
  it("loads the queue and notes, writes an approval, refuses a file changed underneath", async () => {
    await seed();
    expect(await hasEntityData()).toBe(true);
    const files = await loadEntityFiles();
    expect(files.get(NOTE)).toBe(TEXT);
    expect(files.has(PROPOSALS_PATH)).toBe(true);

    const r = approve(files, [PROPS[0].id]);
    await applyEntityOp(files, r);
    const path = entityNotePath({ type: "person", name: "דוד כהן" } as never);
    expect(await workspace.workspaceHasFile(path)).toBe(true);
    expect(await workspace.readWorkspaceFile(PROPOSALS_PATH)).toBe(r.files.get(PROPOSALS_PATH));

    // Computed from the old snapshot while the queue moved on: refused, nothing written.
    const stale = approve(files, [PROPS[1].id]);
    const before = await snapshot();
    await expect(applyEntityOp(files, stale)).rejects.toBeInstanceOf(EntityWriteConflict);
    expect(await snapshot()).toBe(before);
  });

  it("a vault without a graph has nothing to show", async () => {
    await seed(false);
    expect(await hasEntityData()).toBe(false);
  });
});

describe("W12.E5 graph proposals inside the review panel", () => {
  it("sit above the agents' changes; approve writes the note, undo restores the vault's bytes", async () => {
    await seed();
    const start = await snapshot();
    render(<AgentReviewPanel open onClose={() => {}} />);
    const panel = await screen.findByTestId("entity-review", undefined, { timeout: 10_000 });
    const dialog = screen.getByTestId("agent-review-panel");
    // Above the agents' intro and list.
    const intro = within(dialog).getByText((_, el) => el?.tagName === "P" && !!el.textContent && el.compareDocumentPosition(panel) === Node.DOCUMENT_POSITION_PRECEDING, { ignore: "[data-testid=entity-review] *" });
    expect(intro).toBeTruthy();
    expect(within(within(panel).getByRole("listbox")).getAllByRole("option")).toHaveLength(3);
    await axeClean(dialog);

    const list = within(panel).getByRole("listbox");
    await act(async () => {
      fireEvent.keyDown(list, { key: "a" });
    });
    const path = entityNotePath({ type: "person", name: "דוד כהן" } as never);
    await waitFor(async () => expect(await workspace.workspaceHasFile(path)).toBe(true));
    await waitFor(() => expect(within(within(panel).getByRole("listbox")).getAllByRole("option")).toHaveLength(2));

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /undo|ביטול/i }));
    });
    await waitFor(async () => expect(await snapshot()).toBe(start));
    await waitFor(() => expect(within(within(panel).getByRole("listbox")).getAllByRole("option")).toHaveLength(3));
  });

  it("no graph in the vault: the review panel is as before", async () => {
    await seed(false);
    render(<AgentReviewPanel open onClose={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("entity-review")).toBeNull();
    expect(screen.getByTestId("agent-review-panel")).toBeTruthy();
  });
});

describe("W12.E6 ⌘K entries", () => {
  it("the review entry and the graph view (W12.E7 host)", () => {
    const cmds = buildEntityCommands({} as CommandContext);
    expect(cmds.map((c) => c.id)).toEqual(["entities.review", "entities.graph", "entities.contradictions", "entities.wikidata"]); // R12.10 (#961), then W12.E10 (not in airplane mode)
    for (const c of cmds) expect(c.label).not.toMatch(/^cmd\./);
  });

  it("the entity types come from the type registry: a Base and \"All <type>\" each, and an approved note is of its type", async () => {
    await seed();
    const files = await loadEntityFiles();
    await applyEntityOp(files, approve(files, [PROPS[0].id, PROPS[2].id]));
    const reg = await loadVaultTypes();
    for (const type of ENTITY_TYPES) expect(reg.get(type)?.source).toBe("builtin:entities");
    expect(reg.errors).toEqual([]);
    expect(reg.get("person")!.effective.find((f) => f.name === "born_in")).toMatchObject({ kind: "relation", to: "place", multiple: true });
    // ⌘K (W12.T3): "All People", "All Laws", "All Sources", … from the registry.
    const labels = buildTypeCommands([...reg.types.values()].map((x) => ({ id: x.id, label: x.label })), { locale: "en", t: (id, v) => (id === "cmd.typesAll" ? `All ${v!.type}` : id) }).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["All People", "All Laws", "All Sources"]));
    // The approved note says type: person, so the person Base finds it and the place Base does not.
    const path = entityNotePath({ type: "person", name: "דוד כהן" } as never);
    const text = await workspace.readWorkspaceFile(path);
    const fm = parseYaml(text.split("---")[1]) as Record<string, unknown>;
    expect(noteIsA(reg, { fm }, "person")).toBe(true);
    expect(noteIsA(reg, { fm }, "place")).toBe(false);
    expect(typeFilter(reg, "person")).toContain("person");
  });
});
