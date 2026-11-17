/**
 * The field form of a typed note (plan W12.T2), at the top of the
 * properties panel. When a tag or `type:` makes the note a ספר, its fields
 * appear in the type's order: a date input that also shows the Hebrew date
 * (W5.15), a select for options, a relation input that suggests only notes
 * of the target type. A value that does not fit is marked (aria-invalid and
 * the reason), never removed. Every edit is one frontmatter key.
 */
import { useId, useMemo } from "react";
import { t } from "../i18n";
import { hebrewDateOf } from "../editor/templateVars";
import { basesFileFromText } from "../views/bases/base";
import type { TypeRegistry } from "./typeRegistry";
import { formFields, relationCandidates, writeField, type FormField } from "./typedForm";
import "./typedObjectsStrings";

const input = { inlineSize: "100%", fontSize: 12, padding: "3px 6px", border: "1px solid hsl(var(--border))", borderRadius: 4, background: "hsl(var(--bg))", color: "inherit" } as const;
const invalid = { ...input, borderColor: "hsl(var(--danger))" } as const;

export interface TypedNote {
  path: string;
  fm: Record<string, unknown>;
  tags?: readonly string[];
}

/** Notes of the vault for relation pickers, from the index's frontmatter blocks. */
export function typedNotesFromIndex(files: ReadonlyArray<{ path: string; frontmatter: string | null; meta?: { tags: string[] } }>): TypedNote[] {
  return files.filter((f) => /\.(md|markdown)$/i.test(f.path)).map((f) => ({ path: f.path, fm: f.frontmatter ? basesFileFromText(f.path, f.frontmatter).fm : {}, tags: f.meta?.tags ?? [] }));
}

const toInputText = (v: unknown): string => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : Array.isArray(v) ? v.map(String).join(", ") : String(v));
const label = (f: FormField, locale: string) => (locale === "he" ? (f.field.label?.he ?? f.field.label?.en) : (f.field.label?.en ?? f.field.label?.he)) ?? f.field.name;

function FieldInput({ f, id, describedBy, locale, candidates, onWrite }: { f: FormField; id: string; describedBy?: string; locale: string; candidates: string[]; onWrite: (raw: string | string[] | boolean) => void }) {
  const common = { id, "aria-invalid": f.problem ? true : undefined, "aria-describedby": describedBy, dir: "auto" as const, style: f.problem ? invalid : input };
  const text = toInputText(f.value);
  const listId = `${id}-list`;
  if (f.computed) return <output id={id} style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }}>{t("types.form.computed")}</output>;
  switch (f.field.kind) {
    case "checkbox":
      return <input {...common} type="checkbox" style={undefined} checked={f.value === true} onChange={(e) => onWrite(e.target.checked)} />;
    case "select": {
      const opts = f.field.options ?? [];
      const off = text && !opts.includes(text);
      return (
        <select {...common} value={text} onChange={(e) => onWrite(e.target.value)}>
          {/* empty-allow: the "no type" option of the type picker */}
          <option value="">{t("types.form.none")}</option>
          {off && <option value={text}>{t("types.form.notAnOption", { value: text })}</option>}
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    case "multi-select": {
      const have = Array.isArray(f.value) ? f.value.map(String) : text ? [text] : [];
      const opts = [...new Set([...(f.field.options ?? []), ...have])];
      return (
        <fieldset id={id} aria-labelledby={`${id}-label`} aria-invalid={f.problem ? true : undefined} aria-describedby={describedBy} style={{ border: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {opts.map((o) => (
            <label key={o} style={{ fontSize: 12, display: "inline-flex", gap: 3, alignItems: "center" }} dir="auto">
              <input type="checkbox" checked={have.includes(o)} onChange={(e) => onWrite(e.target.checked ? [...have, o] : have.filter((x) => x !== o))} />
              {o}
            </label>
          ))}
        </fieldset>
      );
    }
    case "date":
    case "hebrew-date": {
      const iso = /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
      const hebrew = iso && (f.field.kind === "hebrew-date" || locale === "he") ? hebrewDateOf(new Date(`${iso}T12:00:00Z`), "he") : "";
      return (
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* A value that is not a date stays visible as text, so nothing is lost. */}
          <input {...common} type={f.problem ? "text" : "date"} value={f.problem ? text : iso} onChange={(e) => onWrite(e.target.value)} />
          {hebrew && (
            <span style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }} dir="rtl" lang="he">
              {hebrew}
            </span>
          )}
        </span>
      );
    }
    case "relation":
      return (
        <>
          <input {...common} type="text" list={listId} defaultValue={text} key={text} onBlur={(e) => e.target.value !== text && onWrite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLInputElement).blur())} />
          <datalist id={listId}>
            {candidates.map((c) => (
              <option key={c} value={`[[${c}]]`} />
            ))}
          </datalist>
        </>
      );
    default:
      return <input {...common} type={f.field.kind === "url" ? "url" : "text"} inputMode={f.field.kind === "number" ? "decimal" : undefined} defaultValue={text} key={text} onBlur={(e) => e.target.value !== text && onWrite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLInputElement).blur())} />;
  }
}

export function TypedFields({ reg, text, path, notes, locale, applyEdit }: { reg: TypeRegistry; text: string; path: string; notes: readonly TypedNote[]; locale: string; applyEdit: (edit: (text: string) => string) => void }) {
  const base = useId();
  const note = useMemo(() => basesFileFromText(path || "note.md", text), [path, text]);
  const form = useMemo(() => formFields(reg, note), [reg, note]);
  if (!form.types.length && !form.unknown.length) return null;
  const typeLabel = (id: string) => {
    const x = reg.get(id);
    return (locale === "he" ? (x?.label.he ?? x?.label.en) : (x?.label.en ?? x?.label.he)) ?? id;
  };
  return (
    <section aria-label={t("types.form.title", { type: form.types.map(typeLabel).join(", ") || form.unknown.join(", ") })} data-testid="typed-fields" style={{ paddingBlockEnd: 8, marginBlockEnd: 8, borderBlockEnd: "1px solid hsl(var(--border))" }}>
      <h3 style={{ fontSize: 12, margin: "0 0 6px" }} dir="auto">
        {form.types.map(typeLabel).join(" · ")}
      </h3>
      {form.unknown.length > 0 && (
        <p role="note" style={{ fontSize: 11, color: "hsl(var(--fg-muted))", margin: "0 0 6px" }} dir="auto">
          {t("types.form.unknownType", { type: form.unknown.join(", ") })}
        </p>
      )}
      {form.fields.map((f, i) => {
        const id = `${base}-f${i}`;
        const err = f.problem ? `${id}-err` : undefined;
        return (
          <div key={f.field.name} data-field={f.field.name} style={{ display: "grid", gridTemplateColumns: "minmax(70px, 34%) 1fr", gap: 6, alignItems: "start", paddingBlock: 3 }}>
            {f.field.kind === "multi-select" ? (
              <span id={`${id}-label`} style={{ fontSize: 12, fontWeight: 500 }} dir="auto">
                {label(f, locale)}
              </span>
            ) : (
              <label htmlFor={id} style={{ fontSize: 12, fontWeight: 500 }} dir="auto">
                {label(f, locale)}
              </label>
            )}
            <div>
              <FieldInput f={f} id={id} describedBy={err} locale={locale} candidates={relationCandidates(reg, f.field, notes)} onWrite={(raw) => applyEdit((cur) => writeField(cur, f, raw))} />
              {f.problem && (
                <div id={err} style={{ fontSize: 11, color: "hsl(var(--danger))" }} dir="auto">
                  {t("types.form.mismatch", { reason: f.problem.message })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default TypedFields;
