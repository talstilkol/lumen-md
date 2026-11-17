/**
 * The page of a type (plan W12.T3): "All <type>", like Capacities' "All"
 * dashboard and the table of a Tana supertag. The side list holds every
 * type; the main area runs the type's virtual base (table, cards, kanban)
 * in the ordinary Bases block. "Save as .base" writes it as a real
 * Obsidian `.base` file; an existing file is replaced only after the user
 * approves the change.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { t } from "../i18n";
import { useAppStore } from "../store/useStore";
import { uiConfirm } from "../ui/PromptDialog";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import { showAiToast } from "../ui/AiToast";
import { explainError } from "../lib/userError";
import { saveTypeBase, typeBasePath, typeBaseProblems, typeBaseText } from "./typeBase";
import { useTypeRegistry } from "./vaultTypes";
import { noteIsA } from "./typeRegistry";
import type { BasesFile } from "../views/bases/values";
import "./typedObjectsStrings";
import { Modal } from "../ui/Modal";
import { EmptyState, learnHow } from "../ui/EmptyState";
import { HelpButton } from "../ui/HelpButton";

const BasesBlock = lazy(() => import("../views/bases/BasesBlock"));

const btn = { fontSize: 12, padding: "4px 10px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer" } as const;

export function TypePage({ type, onClose }: { type?: string; onClose: () => void }) {
  const reg = useTypeRegistry();
  const lang = (useAppStore((s) => s.locale) as string) === "he" ? "he" : "en";
  const [picked, setPicked] = useState<string | undefined>(type);
  const types = reg ? [...reg.types.values()] : [];
  const current = picked && reg?.get(picked) ? reg.get(picked)!.id : types[0]?.id;
  const label = (id: string) => {
    const x = reg?.get(id);
    return (lang === "he" ? (x?.label.he ?? x?.label.en) : (x?.label.en ?? x?.label.he)) ?? id;
  };
  const text = useMemo(() => (reg && current ? typeBaseText(reg, current, { lang }) : null), [reg, current, lang]);
  // The rows are the registry's notes of the type (any spelling of `type:`), as runTypeBase does.
  const select = useMemo(() => (reg && current ? (files: readonly BasesFile[]) => new Set(files.filter((f) => noteIsA(reg, f, current)).map((f) => f.path)) : undefined), [reg, current]);
  const problems = reg && current ? [...reg.get(current)!.errors, ...typeBaseProblems(reg, current)] : [];
  const save = async () => {
    if (!reg || !current || !text) return;
    const path = typeBasePath(reg, current, { lang });
    try {
      const done = await saveTypeBase(text, path, { read: readWorkspaceFile, write: (p, x) => writeWorkspaceFile(p, x), confirm: () => uiConfirm({ message: t("types.base.replace", { file: path }) }) });
      if (done) showAiToast(t("types.base.saved", { file: done }));
    } catch (e) {
      showAiToast(t("base.error", { error: explainError(e) }), "error");
    }
  };
  return (
    <Modal onClose={onClose} className="cmd-palette-backdrop" onClick={onClose} aria-label={t("types.page.title")} data-testid="type-page">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100, inlineSize: "95vw", padding: 0, display: "flex", maxHeight: "85vh" }}>
        <nav aria-label={t("types.page.list")} style={{ inlineSize: 180, borderInlineEnd: "1px solid hsl(var(--border))", overflow: "auto", padding: 8 }}>
          <span style={{ float: "inline-end", marginInlineStart: 8 }}><HelpButton topic="workspace/obsidian-bases" /></span>
          <h2 style={{ fontSize: 13, margin: "4px 4px 8px" }}>{t("types.page.list")}</h2>
          {!types.length && <EmptyState style={{ padding: 4 }} message={t("types.page.none")} action={learnHow("workspace/obsidian-bases")} />}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {types.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => setPicked(x.id)} aria-current={x.id === current ? "page" : undefined} style={{ ...btn, border: "none", inlineSize: "100%", textAlign: "start", fontWeight: x.id === current ? 600 : 400 }} dir="auto">
                  {t("types.page.all", { type: label(x.id) })}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main style={{ flex: 1, overflow: "auto", padding: 12 }}>
          <header style={{ display: "flex", gap: 8, alignItems: "center", marginBlockEnd: 8 }}>
            <h2 style={{ margin: 0, fontSize: 15, flex: 1 }} dir="auto">
              {current ? t("types.page.all", { type: label(current) }) : t("types.page.title")}
            </h2>
            {text && (
              <button type="button" style={btn} onClick={() => void save()} data-testid="type-save-base">
                {t("types.base.save")}
              </button>
            )}
            <button type="button" style={btn} onClick={onClose} aria-label={t("types.page.close")}>
              ×
            </button>
          </header>
          {problems.length > 0 && (
            <div role="alert" style={{ fontSize: 11, color: "hsl(var(--danger))" }}>
              {problems.slice(0, 5).map((p) => (
                <div key={p} dir="auto">
                  {p}
                </div>
              ))}
            </div>
          )}
          {text && (
            <Suspense fallback={<div style={{ fontSize: 12 }}>{t("db.loading")}</div>}>
              <BasesBlock source={text} select={select} />
            </Suspense>
          )}
        </main>
      </div>
    </Modal>
  );
}
