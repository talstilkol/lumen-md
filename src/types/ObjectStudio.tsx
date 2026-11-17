/**
 * Object Studio (plan W12.T2), from ⌘K: make a type, add a field to one,
 * rename a field everywhere, and start a new note of a type.
 *
 * Renaming a field changes every note of the type that has it. Those
 * changes go to the review screen (agents/staging.ts) like any other batch
 * of file changes; the type file follows once every note change of the batch
 * is approved. While the studio is open, one Ctrl+Z undoes the whole rename
 * (every note and the type file that still hold what the rename wrote).
 */
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { showAiToast } from "../ui/AiToast";
import { explainError } from "../lib/userError";
import { listWorkspace, readWorkspaceFile, workspaceHasFile, writeWorkspaceFile } from "../storage/workspace";
import { notifyWorkspaceChanged } from "../storage/workspaceEvents";
import { onStagedChanges, stageChange } from "../agents/staging";
import { openTemplateDoc } from "../commands/openDoc";
import { basesFileFromText } from "../views/bases/base";
import { FIELD_KINDS, typeFilePath, type FieldKind } from "./typeSchema";
import { useTypeRegistry, TYPES_CHANGED_EVENT } from "./vaultTypes";
import { addFieldToTypeText, newTypedNote, newTypeFile, planFieldRename, templatePathOf, undoFileChanges, type FileChange } from "./typedForm";
import type { TypeRegistry } from "./typeRegistry";
import "./typedObjectsStrings";
import { Modal } from "../ui/Modal";

const btn = { fontSize: 12, padding: "4px 10px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer" } as const;
const field = { fontSize: 12, padding: "3px 6px", border: "1px solid hsl(var(--border))", borderRadius: 4, background: "hsl(var(--bg))", color: "inherit" } as const;

const io = {
  read: async (p: string) => ((await workspaceHasFile(p)) ? readWorkspaceFile(p) : null),
  write: async (p: string, text: string) => {
    await writeWorkspaceFile(p, text);
  },
};

const changed = () => window.dispatchEvent(new CustomEvent(TYPES_CHANGED_EVENT));

/** Start a new note of a type, with its template (W12.T2). */
export async function startTypedNote(reg: TypeRegistry, typeId: string, title: string, locale: string): Promise<boolean> {
  const tplPath = templatePathOf(reg, typeId);
  const templateBody = tplPath ? ((await io.read(tplPath)) ?? undefined) : undefined;
  const made = newTypedNote(reg, typeId, { title, templateBody, locale });
  if (!made.ok) {
    showAiToast(made.problems.map((p) => p.message).join("; "), "error");
    return false;
  }
  openTemplateDoc(`${title || typeId}.md`, made.text);
  return true;
}

interface RenameRun {
  runId: string;
  ids: string[];
  notes: FileChange[];
  typeFile: FileChange;
  state: "review" | "applied" | "partial" | "undone";
}

export function ObjectStudio({ onClose, locale }: { onClose: () => void; locale: string }) {
  const reg = useTypeRegistry();
  const types = useMemo(() => (reg ? [...reg.types.values()] : []), [reg]);
  const name = (id: string) => {
    const x = reg?.get(id);
    return (locale === "he" ? (x?.label.he ?? x?.label.en) : (x?.label.en ?? x?.label.he)) ?? id;
  };
  const [nt, setNt] = useState({ id: "", he: "", en: "", tag: "" });
  const [nf, setNf] = useState({ type: "", name: "", kind: "text" as FieldKind, options: "", to: "" });
  const [rn, setRn] = useState({ type: "", from: "", to: "" });
  const [newNote, setNewNote] = useState({ type: "", title: "" });
  const [run, setRun] = useState<RenameRun | null>(null);

  // The rename's batch: when every note change is approved, the type file follows.
  useEffect(() => {
    if (!run || run.state !== "review") return;
    return onStagedChanges((list) => {
      const mine = list.filter((c) => run.ids.includes(c.id));
      if (mine.some((c) => c.status === "pending")) return;
      const all = mine.length === run.ids.length && mine.every((c) => c.status === "applied");
      void (async () => {
        if (all) {
          await io.write(run.typeFile.path, run.typeFile.after);
          changed();
          showAiToast(t("types.studio.renamed", { count: run.notes.length }));
        } else showAiToast(t("types.studio.renamePartial"), "error");
        setRun({ ...run, state: all ? "applied" : "partial" });
      })();
    });
  }, [run]);

  const undo = async () => {
    if (!run || (run.state !== "applied" && run.state !== "partial")) return;
    const r = await undoFileChanges([run.typeFile, ...run.notes], io);
    notifyWorkspaceChanged({ kind: "content", paths: r.restored });
    changed();
    setRun({ ...run, state: "undone" });
    showAiToast(r.changedSince.length ? t("types.studio.undoPartial", { count: r.restored.length, left: r.changedSince.length }) : t("types.studio.undone", { count: r.restored.length }));
  };
  // One Ctrl+Z (⌘Z) while the studio is open undoes the whole rename.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && run && (run.state === "applied" || run.state === "partial")) {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const guard = (fn: () => Promise<void>) => () =>
    void fn().catch((e) => {
      showAiToast(t("types.studio.failed", { error: explainError(e) }), "error");
    });

  const createType = guard(async () => {
    const f = newTypeFile(nt.id, { ...(nt.he ? { he: nt.he } : {}), ...(nt.en ? { en: nt.en } : {}) }, { tag: nt.tag || undefined });
    if ((await io.read(f.path)) !== null) throw new Error(t("types.studio.exists", { id: nt.id }));
    await io.write(f.path, f.text);
    changed();
    setNt({ id: "", he: "", en: "", tag: "" });
    showAiToast(t("types.studio.created", { type: nt.he || nt.en || nt.id }));
  });

  const addField = guard(async () => {
    const path = typeFilePath(nf.type);
    const before = await io.read(path);
    if (before === null) throw new Error(t("types.studio.noFile", { file: path }));
    const options = nf.options.split(",").map((x) => x.trim()).filter(Boolean);
    await io.write(path, addFieldToTypeText(before, nf.name.trim(), nf.kind, { ...(options.length ? { options } : {}), ...(nf.kind === "relation" ? { to: nf.to } : {}) }));
    changed();
    setNf({ ...nf, name: "", options: "" });
    showAiToast(t("types.studio.fieldAdded", { field: nf.name }));
  });

  const rename = guard(async () => {
    if (!reg) return;
    const path = typeFilePath(rn.type);
    const typeText = await io.read(path);
    if (typeText === null) throw new Error(t("types.studio.noFile", { file: path }));
    const notes: Array<{ path: string; text: string; note: ReturnType<typeof basesFileFromText> }> = [];
    for (const e of await listWorkspace({ includeAssets: false })) {
      if (!/\.(md|markdown)$/i.test(e.path)) continue;
      const text = await readWorkspaceFile(e.path);
      notes.push({ path: e.path, text, note: basesFileFromText(e.path, text) });
    }
    const plan = planFieldRename(reg, rn.type, rn.from, rn.to.trim(), { path, text: typeText }, notes);
    const [typeFile, ...noteChanges] = plan.changes;
    const runId = `types-rename-${Date.now().toString(36)}`;
    const ids = noteChanges.map((c) => stageChange({ kind: "file", path: c.path, before: c.before, after: c.after, summary: t("types.studio.renameSummary", { from: rn.from, to: rn.to }) }, { tool: "object_studio.rename_field", runId }).id);
    setRun({ runId, ids, notes: noteChanges, typeFile, state: "review" });
    if (!ids.length) {
      await io.write(typeFile.path, typeFile.after);
      changed();
      setRun({ runId, ids, notes: [], typeFile, state: "applied" });
      return showAiToast(t("types.studio.renamed", { count: 0 }));
    }
    window.dispatchEvent(new CustomEvent("lumen-open-agent-review"));
    showAiToast(t("types.studio.inReview", { count: ids.length }));
  });

  const ownFields = reg && rn.type ? (reg.get(rn.type)?.effective ?? []).filter((f) => reg.get(rn.type)!.declaredBy[f.name] === rn.type) : [];
  const typeSelect = (value: string, onChange: (v: string) => void, labelText: string) => (
    <select aria-label={labelText} value={value} onChange={(e) => onChange(e.target.value)} style={field}>
      <option value="">{labelText}</option>
      {types.map((x) => (
        <option key={x.id} value={x.id}>
          {name(x.id)}
        </option>
      ))}
    </select>
  );
  const row = { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBlockEnd: 6 } as const;

  return (
    <Modal onClose={onClose} className="cmd-palette-backdrop" onClick={onClose} aria-labelledby="object-studio-title" data-testid="object-studio">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, padding: 16, maxHeight: "85vh", overflow: "auto" }}>
        <header style={{ display: "flex", alignItems: "center", marginBlockEnd: 8 }}>
          <h2 id="object-studio-title" style={{ margin: 0, fontSize: 15, flex: 1 }}>
            {t("types.studio.title")}
          </h2>
          <button type="button" style={btn} onClick={onClose} aria-label={t("types.page.close")}>
            ×
          </button>
        </header>

        <form onSubmit={(e) => (e.preventDefault(), createType())} aria-labelledby="studio-new-type">
          <h3 id="studio-new-type" style={{ fontSize: 13 }}>{t("types.studio.newType")}</h3>
          <div style={row}>
            <input aria-label={t("types.studio.id")} placeholder={t("types.studio.id")} value={nt.id} onChange={(e) => setNt({ ...nt, id: e.target.value })} style={field} dir="auto" required />
            <input aria-label={t("types.studio.labelHe")} placeholder={t("types.studio.labelHe")} value={nt.he} onChange={(e) => setNt({ ...nt, he: e.target.value })} style={field} dir="rtl" lang="he" />
            <input aria-label={t("types.studio.labelEn")} placeholder={t("types.studio.labelEn")} value={nt.en} onChange={(e) => setNt({ ...nt, en: e.target.value })} style={field} dir="ltr" lang="en" />
            <input aria-label={t("types.studio.tag")} placeholder={t("types.studio.tag")} value={nt.tag} onChange={(e) => setNt({ ...nt, tag: e.target.value })} style={field} dir="auto" />
            <button type="submit" style={btn}>{t("types.studio.create")}</button>
          </div>
        </form>

        <form onSubmit={(e) => (e.preventDefault(), addField())} aria-labelledby="studio-add-field">
          <h3 id="studio-add-field" style={{ fontSize: 13 }}>{t("types.studio.addField")}</h3>
          <div style={row}>
            {typeSelect(nf.type, (v) => setNf({ ...nf, type: v }), t("types.studio.pickType"))}
            <input aria-label={t("types.studio.fieldName")} placeholder={t("types.studio.fieldName")} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} style={field} dir="auto" required />
            <select aria-label={t("types.studio.kind")} value={nf.kind} onChange={(e) => setNf({ ...nf, kind: e.target.value as FieldKind })} style={field}>
              {FIELD_KINDS.filter((k) => k !== "rollup" && k !== "formula").map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {(nf.kind === "select" || nf.kind === "multi-select") && <input aria-label={t("types.studio.options")} placeholder={t("types.studio.options")} value={nf.options} onChange={(e) => setNf({ ...nf, options: e.target.value })} style={field} dir="auto" />}
            {nf.kind === "relation" && typeSelect(nf.to, (v) => setNf({ ...nf, to: v }), t("types.studio.relationTo"))}
            <button type="submit" style={btn} disabled={!nf.type}>{t("types.studio.add")}</button>
          </div>
        </form>

        <form onSubmit={(e) => (e.preventDefault(), rename())} aria-labelledby="studio-rename">
          <h3 id="studio-rename" style={{ fontSize: 13 }}>{t("types.studio.renameField")}</h3>
          <div style={row}>
            {typeSelect(rn.type, (v) => setRn({ type: v, from: "", to: "" }), t("types.studio.pickType"))}
            <select aria-label={t("types.studio.from")} value={rn.from} onChange={(e) => setRn({ ...rn, from: e.target.value })} style={field}>
              <option value="">{t("types.studio.from")}</option>
              {ownFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
            <input aria-label={t("types.studio.to")} placeholder={t("types.studio.to")} value={rn.to} onChange={(e) => setRn({ ...rn, to: e.target.value })} style={field} dir="auto" required />
            <button type="submit" style={btn} disabled={!rn.type || !rn.from || !rn.to.trim() || run?.state === "review"}>
              {t("types.studio.rename")}
            </button>
            {run && (run.state === "applied" || run.state === "partial") && (
              <button type="button" style={btn} onClick={() => void undo()} aria-keyshortcuts="Control+Z">
                {t("types.studio.undo")}
              </button>
            )}
          </div>
          {run?.state === "review" && <p role="status" style={{ fontSize: 12 }}>{t("types.studio.inReview", { count: run.ids.length })}</p>}
        </form>

        <form onSubmit={(e) => (e.preventDefault(), reg && void startTypedNote(reg, newNote.type, newNote.title.trim(), locale).then((ok) => ok && onClose()))} aria-labelledby="studio-new-note">
          <h3 id="studio-new-note" style={{ fontSize: 13 }}>{t("types.studio.newNote")}</h3>
          <div style={row}>
            {typeSelect(newNote.type, (v) => setNewNote({ ...newNote, type: v }), t("types.studio.pickType"))}
            <input aria-label={t("types.studio.noteTitle")} placeholder={t("types.studio.noteTitle")} value={newNote.title} onChange={(e) => setNewNote({ ...newNote, title: e.target.value })} style={field} dir="auto" required />
            <button type="submit" style={btn} disabled={!newNote.type}>{t("types.studio.createNote")}</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
