/**
 * The clip templates and triggers editor (plan 4.15, W10.E67). The built-in
 * site templates are read-only and can be duplicated. The user's own templates
 * are written to .lumen/clip-templates.json (clipTemplateStore.ts) and win over
 * the built-in ones when a clip is saved. "Test an address" shows which
 * template a page would get and by which trigger, and a preview of the note
 * it makes from sample values. Obsidian Web Clipper exports import as they are.
 * Loaded on use from the palette (`research.clipTemplates`).
 */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./clipTemplatesStrings";
import { t } from "../i18n";
import { explainError } from "../lib/userError";
import { Modal } from "../ui/Modal";
import { DEFAULT_TEMPLATE, SITE_TEMPLATES, renderClip, type ClipTemplate, type ClipVars } from "./clipTemplates";
import { importObsidianTemplate, loadUserTemplates, saveUserTemplates, templateId, templateProblems, whichTemplate, type TemplateIo } from "./clipTemplateStore";

/** Sample values for the preview: what a clipped article would give. */
const SAMPLE: ClipVars = {
  title: "Sample article",
  url: "https://example.org/sample-article",
  domain: "example.org",
  author: "A. Writer",
  published: "2026-11-01",
  site: "Example",
  description: "A sample page for the template preview.",
  date: "2026-11-15",
  content: "The article's text, as Markdown.",
  selection: "",
  highlights: "",
  library: "Clippings",
  transcript: "",
};

const propsToText = (p: ClipTemplate["properties"]) => p.map((x) => `${x.name}: ${x.value}`).join("\n");
const textToProps = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      return i < 0 ? { name: l, value: "" } : { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
    });

export function ClipTemplatesEditor({ onClose, initial, io }: { onClose: () => void; initial: ClipTemplate[]; io?: TemplateIo | null }) {
  const [mine, setMine] = useState<ClipTemplate[]>(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? SITE_TEMPLATES[0]?.id ?? null);
  const [testUrl, setTestUrl] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const builtIn = useMemo(() => [...SITE_TEMPLATES, DEFAULT_TEMPLATE], []);
  const current = mine.find((x) => x.id === selected) ?? builtIn.find((x) => x.id === selected) ?? null;
  const editable = !!current && mine.includes(current);
  const problems = current && editable ? templateProblems(current, mine) : [];

  const update = (patch: Partial<ClipTemplate>) => {
    if (!current || !editable) return;
    setMine((list) => list.map((x) => (x === current ? { ...x, ...patch } : x)));
    setStatus(null);
  };
  const uniqueId = (base: string) => {
    let id = base;
    for (let i = 2; [...mine, ...builtIn].some((x) => x.id === id); i++) id = `${base}-${i}`;
    return id;
  };
  const add = (from?: ClipTemplate) => {
    const name = from ? `${from.name} (${t("clipTemplates.copy")})` : t("clipTemplates.untitled");
    const tpl: ClipTemplate = from ? { ...structuredClone(from), id: uniqueId(templateId(name)), name } : { ...structuredClone(DEFAULT_TEMPLATE), id: uniqueId(templateId(name)), name, triggers: [] };
    setMine((list) => [...list, tpl]);
    setSelected(tpl.id);
  };
  const remove = () => {
    if (!current || !editable) return;
    setMine((list) => list.filter((x) => x !== current));
    setSelected(null);
  };
  const save = async () => {
    try {
      await saveUserTemplates(mine, io);
      setStatus({ kind: "ok", text: t("clipTemplates.saved") });
    } catch (e) {
      setStatus({ kind: "error", text: explainError(e, "clipTemplates") });
    }
  };
  const importFile = async (f: File) => {
    try {
      const got = importObsidianTemplate(await f.text()).map((x) => ({ ...x, id: uniqueId(x.id) }));
      setMine((list) => [...list, ...got]);
      setSelected(got[0]?.id ?? selected);
      setStatus({ kind: "ok", text: t("clipTemplates.imported", { count: String(got.length) }) });
    } catch (e) {
      setStatus({ kind: "error", text: t("clipTemplates.importFailed", { error: explainError(e, "clipTemplates") }) });
    }
  };

  const hit = testUrl.trim() ? whichTemplate(testUrl.trim(), [...mine, ...builtIn]) : null;
  const preview = current ? renderClip(current, { ...SAMPLE, url: testUrl.trim() || SAMPLE.url }) : null;
  const item = (x: ClipTemplate) => (
    <li key={x.id}>
      <button type="button" aria-pressed={x.id === selected} onClick={() => setSelected(x.id)} data-testid={`clip-template-${x.id}`} style={{ inlineSize: "100%", textAlign: "start", fontWeight: x.id === selected ? 600 : 400 }}>
        <span dir="auto">{x.name}</span>
      </button>
    </li>
  );
  const field = { display: "block", inlineSize: "100%", marginBlockStart: 2 } as const;
  return (
    <Modal aria-label={t("clipTemplates.title")} onClose={onClose} className="cmd-palette-backdrop" data-testid="clip-templates-editor">
      <div className="cmd-palette" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, fontSize: 13, maxInlineSize: 900, inlineSize: "95vw" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ flex: 1 }}>{t("clipTemplates.title")}</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("clipTemplates.close")}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 16, minBlockSize: 0, flexWrap: "wrap" }}>
          <nav style={{ inlineSize: 220, flexShrink: 0 }} aria-label={t("clipTemplates.title")}>
            <div style={{ fontWeight: 600 }}>{t("clipTemplates.yours")}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 10px" }}>{mine.map(item)}</ul>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={() => add()} data-testid="clip-templates-new">{t("clipTemplates.new")}</button>
              <label style={{ cursor: "pointer" }}>
                <span className="btn">{t("clipTemplates.import")}</span>
                <input type="file" accept=".json,application/json" hidden data-testid="clip-templates-import" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
              </label>
            </div>
            <div style={{ fontWeight: 600, marginBlockStart: 12 }}>{t("clipTemplates.builtIn")}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "4px 0" }}>{builtIn.map(item)}</ul>
          </nav>
          {current && (
            <section style={{ flex: 1, minInlineSize: 280, display: "flex", flexDirection: "column", gap: 6 }} data-testid="clip-template-form">
              {!editable && (
                <p style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>
                  {t("clipTemplates.readOnly")}{" "}
                  <button type="button" onClick={() => add(current)} data-testid="clip-templates-duplicate">{t("clipTemplates.duplicate")}</button>
                </p>
              )}
              <label>{t("clipTemplates.name")}<input dir="auto" style={field} readOnly={!editable} value={current.name} onChange={(e) => update({ name: e.target.value })} data-testid="clip-template-name" /></label>
              <label>{t("clipTemplates.path")}<input dir="ltr" style={field} readOnly={!editable} value={current.path} onChange={(e) => update({ path: e.target.value })} /></label>
              <label>{t("clipTemplates.noteName")}<input dir="ltr" style={field} readOnly={!editable} value={current.noteName} onChange={(e) => update({ noteName: e.target.value })} /></label>
              <label>{t("clipTemplates.triggers")}<textarea dir="ltr" rows={3} style={field} readOnly={!editable} value={(current.triggers ?? []).join("\n")} onChange={(e) => update({ triggers: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} data-testid="clip-template-triggers" /></label>
              <label>{t("clipTemplates.properties")}<textarea dir="ltr" rows={4} style={field} readOnly={!editable} value={propsToText(current.properties)} onChange={(e) => update({ properties: textToProps(e.target.value) })} /></label>
              <label>{t("clipTemplates.content")}<textarea dir="auto" rows={5} style={field} readOnly={!editable} value={current.content} onChange={(e) => update({ content: e.target.value })} /></label>
              {problems.length > 0 && (
                <ul role="alert" data-testid="clip-template-problems" style={{ color: "hsl(var(--danger))", margin: 0 }}>
                  {problems.map((p, i) => <li key={i}>{t(p.key, { detail: p.detail ?? "" })}</li>)}
                </ul>
              )}
              {editable && (
                <div>
                  <button type="button" onClick={remove} data-testid="clip-templates-delete">{t("clipTemplates.delete")}</button>
                </div>
              )}
            </section>
          )}
        </div>
        <label>
          {t("clipTemplates.test")}
          <input dir="ltr" style={field} placeholder="https://" /* i18n-allow: a URL scheme, the same in every language */ value={testUrl} onChange={(e) => setTestUrl(e.target.value)} data-testid="clip-templates-test" />
        </label>
        {testUrl.trim() && (
          <div role="status" data-testid="clip-templates-test-result">
            {hit ? t("clipTemplates.testResult", { name: hit.template.name, trigger: hit.trigger }) : t("clipTemplates.testDefault")}
          </div>
        )}
        {preview && (
          <details>
            <summary>{t("clipTemplates.preview")}</summary>
            <pre dir="auto" data-testid="clip-templates-preview" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{`${preview.folder}/${preview.fileName}\n\n${preview.markdown}`}</pre>
          </details>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => void save()} disabled={mine.some((x) => templateProblems(x, mine).length > 0)} data-testid="clip-templates-save">{t("clipTemplates.save")}</button>
          {status && <span role={status.kind === "error" ? "alert" : "status"} style={{ color: status.kind === "error" ? "hsl(var(--danger))" : "hsl(var(--fg-muted))" }}>{status.text}</span>}
        </div>
      </div>
    </Modal>
  );
}

let close: (() => void) | null = null;

/** Open the editor with the vault's templates (run again to close it). */
export async function openClipTemplatesEditor(): Promise<void> {
  if (close) {
    close();
    return;
  }
  const initial = await loadUserTemplates();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  close = () => {
    close = null;
    root.unmount();
    host.remove();
  };
  root.render(<ClipTemplatesEditor initial={initial} onClose={() => close?.()} />);
}
