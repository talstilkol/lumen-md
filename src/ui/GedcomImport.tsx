/**
 * "Import GEDCOM" on the entity graph screen (plan W13.G7): pick a .ged
 * file (MyHeritage, Ancestry, Gramps, FamilySearch — 5.5.1 or 7.0), see
 * what it holds — people, families, problems — and import: a person note
 * per individual, an import note with a paragraph per family, and the
 * spouse / child edges, written together (all or nothing, ../entities/
 * vaultIo.ts). Nothing is read from or sent to the network.
 */
import { useRef, useState } from "react";
import { t } from "../i18n";
import type { ImportPlan } from "../entities/gedcom";
import { EDGES_PATH, appendEdge } from "../entities/store";
import { applyEntityOp, type EntityVault } from "../entities/vaultIo";
import { explainError } from "../lib/userError";

export interface GedcomImportProps {
  /** The vault's files as the screen read them (entity notes and edges). */
  files: ReadonlyMap<string, string> | null;
  /** Entity ids already in the vault. */
  taken: ReadonlySet<string>;
  vault?: EntityVault;
  onImported: (plan: ImportPlan) => void;
}

/** The plan as one entity operation: new files, and edges.jsonl with the new edges. */
export function planToOp(plan: ImportPlan, files: ReadonlyMap<string, string>): { basis: Map<string, string>; result: { files: Map<string, string>; undo: Map<string, string | null>; written: string[]; removed: string[] } } {
  const basis = new Map(files);
  const out = new Map(files);
  const written: string[] = [];
  for (const [p, c] of plan.files) {
    if (out.has(p)) continue; // never overwrite a note that is there (names are made unique against the vault)
    out.set(p, c);
    written.push(p);
  }
  let edgesText = files.get(EDGES_PATH) ?? "";
  for (const e of plan.edges) edgesText = appendEdge(edgesText, e);
  out.set(EDGES_PATH, edgesText);
  written.push(EDGES_PATH);
  return { basis, result: { files: out, undo: new Map(), written, removed: [] } };
}

export function GedcomImport({ files, taken, vault, onImported }: GedcomImportProps) {
  const input = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<{ plan: ImportPlan; name: string; families: number } | null>(null);
  const [status, setStatus] = useState("");

  const pick = async (file: File) => {
    try {
      const { parseGedcom, planGedcomImport } = await import("../entities/gedcom");
      const ged = parseGedcom(await file.text());
      if (!ged.people.length) return setStatus(t("family.import.none", { file: file.name }));
      const p = planGedcomImport(ged, { fileName: file.name, taken, labels: { title: t("family.import.noteTitle"), family: t("family.import.family"), children: t("family.import.children") } });
      setPlan({ plan: p, name: file.name, families: ged.families.length });
      setStatus("");
    } catch (e) {
      setStatus(t("family.import.failed", { error: explainError(e) }));
    }
  };

  const run = async () => {
    if (!plan || !files) return;
    try {
      const { basis, result } = planToOp(plan.plan, files);
      await applyEntityOp(basis, result, vault);
      setStatus(t("family.import.done", { people: plan.plan.entities.length, edges: plan.plan.edges.length }));
      onImported(plan.plan);
      setPlan(null);
    } catch (e) {
      setStatus(t("family.import.failed", { error: explainError(e) }));
    }
  };

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
      <input ref={input} type="file" accept=".ged,.gedcom,text/plain" hidden data-testid="gedcom-file" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
      <button type="button" onClick={() => input.current?.click()} data-testid="gedcom-import" disabled={!files}>
        {t("family.import.button")}
      </button>
      {plan && (
        <span role="group" aria-label={t("family.import.confirm")} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span data-testid="gedcom-preview">{t("family.import.preview", { file: plan.name, people: plan.plan.entities.length, families: plan.families, problems: plan.plan.problems.length })}</span>
          <button type="button" onClick={() => void run()} data-testid="gedcom-import-run">
            {t("family.import.run")}
          </button>
          <button type="button" onClick={() => setPlan(null)}>
            {t("family.import.cancel")}
          </button>
        </span>
      )}
      <span role="status" aria-live="polite" data-testid="gedcom-status">
        {status}
      </span>
    </span>
  );
}
