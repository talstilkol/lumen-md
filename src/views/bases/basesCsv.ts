/**
 * CSV export and import for a base (plan W1.12), out of BasesBlock.tsx to keep
 * it under 800 lines. Loaded with BasesBlock (lazily, never at startup).
 */
import type { BaseModel, BaseResult } from "./base";
import type { BasesFile } from "./values";
import { writeWorkspaceFile } from "../../storage/workspace";
import { csvToNotes, pinnedProperties, resultToCsv } from "./viewsData";
import { showAiToast } from "../../ui/AiToast";
import { t } from "../../i18n";
import { explainError } from "../../lib/userError";

export function downloadCsv(result: BaseResult, name: string) {
  const blob = new Blob(["\uFEFF", resultToCsv(result)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/^.*\//, "").replace(/\.base$/i, "") || "base"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Pick a CSV and add one note per row to a folder named after the base, with the properties its filter pins. */
export async function importCsv(base: BaseModel, name: string, files: readonly BasesFile[]) {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
  if (!file) return;
  const folder = name.replace(/^.*\//, "").replace(/\.base$/i, "") || "Imported";
  try {
    const notes = csvToNotes(await file.text(), folder, { extra: pinnedProperties(base.filters), taken: new Set(files.map((f) => f.path)) });
    for (const n of notes) await writeWorkspaceFile(n.path, n.content);
    const { notifyWorkspaceChanged } = await import("../../storage/workspaceEvents");
    notifyWorkspaceChanged({ kind: "structure", paths: notes.map((n) => n.path) });
    showAiToast(t("base.csv.imported", { count: notes.length, folder }));
  } catch (e) {
    showAiToast(t("base.csv.failed", { error: explainError(e) }), "error");
  }
}
