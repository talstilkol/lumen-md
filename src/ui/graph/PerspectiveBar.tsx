/**
 * The perspective bar (plan W13.G9): pick a saved view of the graph, save
 * the current one as a new view or over the open one, delete one (with
 * undo), and style each kind — colour, size fixed or by links, scale.
 * Alt+1…Alt+9 inside the graph switch between the first nine views.
 *
 * The host owns the view's state: it gives the current filters
 * (`snapshot`) and the style rules, and applies a perspective it is handed.
 * The bar reads and writes `.lumen/graph/perspectives.json`.
 *
 * The host imports ./perspectiveStrings (its English); this file does not.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { t } from "../../i18n";
import {
  emptyPerspectives,
  loadPerspectives,
  newPerspectiveId,
  removePerspective,
  savePerspectives,
  upsertPerspective,
  type KindRule,
  type Perspective,
  type PerspectiveFile,
  type PerspectiveFilter,
  type PerspectiveScope,
  type PerspectiveVault,
} from "../../graph/perspectives";

export interface PerspectiveBarProps {
  scope: PerspectiveScope;
  /** The kinds the style editor lists, in order. */
  kinds: readonly string[];
  kindLabel: (kind: string) => string;
  /** The colour a kind has without a rule (`#rrggbb`). */
  defaultColor: (kind: string) => string;
  rules: Readonly<Record<string, KindRule>>;
  onRules: (rules: Record<string, KindRule>) => void;
  snapshot: () => PerspectiveFilter;
  onApply: (p: Perspective) => void;
  /** Alt+digit is listened for inside this element. */
  hotkeyRoot?: RefObject<HTMLElement | null>;
  vault?: PerspectiveVault;
  style?: React.CSSProperties;
}

export function PerspectiveBar({ scope, kinds, kindLabel, defaultColor, rules, onRules, snapshot, onApply, hotkeyRoot, vault, style }: PerspectiveBarProps) {
  const [file, setFile] = useState<PerspectiveFile>(emptyPerspectives());
  const [current, setCurrent] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [undo, setUndo] = useState<PerspectiveFile | null>(null);
  const [status, setStatus] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const mine = file.perspectives.filter((p) => p.scope === scope);

  useEffect(() => {
    let off = false;
    loadPerspectives(vault).then(
      ({ file: f, problems }) => {
        if (off || writes.current) return; // a write already read the file afresh
        setFile(f);
        if (problems.length) setStatus(t("graphPersp.problems", { n: problems.length }));
      },
      () => !off && setStatus(t("graphPersp.loadFailed")),
    );
    return () => {
      off = true;
    };
  }, [vault]);

  // Read, change, write: the change applies to the file as it is in the vault now (another tab, a sync,
  // or a load still on its way never loses a view), and the latest wins on screen.
  const writes = useRef(0);
  const write = async (change: (f: PerspectiveFile) => PerspectiveFile, message: string): Promise<PerspectiveFile | null> => {
    writes.current++;
    try {
      const now = await loadPerspectives(vault).then((r) => r.file, () => file);
      const next = change(now);
      await savePerspectives(next, vault);
      setFile(next);
      setStatus(message);
      return now;
    } catch {
      setStatus(t("graphPersp.saveFailed"));
      return null;
    }
  };

  const open = (id: string) => {
    setCurrent(id);
    const p = mine.find((x) => x.id === id);
    if (!p) return;
    onApply(p);
    setStatus(t("graphPersp.opened", { name: p.name }));
  };

  // Alt+1…9: the first nine views of this scope.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const el = hotkeyRoot?.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (!n) return;
      const p = file.perspectives.filter((x) => x.scope === scope)[Number(n) - 1];
      if (!p) return;
      e.preventDefault();
      openRef.current(p.id);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [hotkeyRoot, file, scope]);

  const saveAs = async () => {
    const n = name.trim();
    if (!n) return;
    const rest = { name: n, scope, rules: { ...rules }, filter: snapshot() };
    setNaming(false);
    setName("");
    let id = "";
    await write((f) => {
      id = newPerspectiveId(f, n);
      return upsertPerspective(f, { id, ...rest });
    }, t("graphPersp.saved", { name: n }));
    setCurrent(id);
  };
  const update = async () => {
    const p = mine.find((x) => x.id === current);
    if (!p) return;
    const next = { ...p, rules: { ...rules }, filter: snapshot() };
    await write((f) => upsertPerspective(f, next), t("graphPersp.saved", { name: p.name }));
  };
  const remove = async () => {
    const p = mine.find((x) => x.id === current);
    if (!p) return;
    setCurrent("");
    const before = await write((f) => removePerspective(f, p.id), t("graphPersp.deleted", { name: p.name }));
    if (before) setUndo(before);
  };
  const restore = async () => {
    if (!undo) return;
    const back = undo;
    setUndo(null);
    await write(() => back, t("graphPersp.restored"));
  };
  const setRule = (kind: string, patch: Partial<KindRule>) => onRules({ ...rules, [kind]: { ...rules[kind], ...patch } });

  return (
    <div role="group" aria-label={t("graphPersp.label")} data-testid="graph-perspectives" style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        {t("graphPersp.view")}
        <select value={current} onChange={(e) => open(e.target.value)} data-testid="graph-perspective" aria-keyshortcuts="Alt+1 Alt+2 Alt+3" style={style}>
          {/* empty-allow: the "no perspective" option of a select, not an empty state */}
          <option value="">{t("graphPersp.none")}</option>
          {mine.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i < 9 ? `${p.name} (Alt+${i + 1})` : p.name}
            </option>
          ))}
        </select>
      </label>
      {naming ? (
        <span style={{ display: "inline-flex", gap: 4 }}>
          <input
            ref={nameInput}
            dir="auto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveAs();
              if (e.key === "Escape") setNaming(false);
            }}
            aria-label={t("graphPersp.name")}
            placeholder={t("graphPersp.name")}
            data-testid="graph-perspective-name"
            style={style}
          />
          <button type="button" onClick={() => void saveAs()} disabled={!name.trim()} data-testid="graph-perspective-save-confirm">
            {t("graphPersp.save")}
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => (setNaming(true), setTimeout(() => nameInput.current?.focus(), 0))} data-testid="graph-perspective-save-as">
          {t("graphPersp.saveAs")}
        </button>
      )}
      <button type="button" onClick={() => void update()} disabled={!current} data-testid="graph-perspective-update">
        {t("graphPersp.update")}
      </button>
      <button type="button" onClick={() => void remove()} disabled={!current} data-testid="graph-perspective-delete">
        {t("graphPersp.delete")}
      </button>
      {undo && (
        <button type="button" onClick={() => void restore()} data-testid="graph-perspective-undo">
          {t("graphPersp.undo")}
        </button>
      )}
      <details>
        <summary>{t("graphPersp.style")}</summary>
        <table style={{ fontSize: 12 }} data-testid="graph-perspective-style">
          <thead>
            <tr>
              <th scope="col">{t("graphPersp.kind")}</th>
              <th scope="col">{t("graphPersp.color")}</th>
              <th scope="col">{t("graphPersp.size")}</th>
              <th scope="col">{t("graphPersp.scale")}</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k} data-kind={k}>
                <th scope="row" style={{ fontWeight: 400, textAlign: "start" }}>
                  <bdi>{kindLabel(k)}</bdi>
                </th>
                <td>
                  <input type="color" value={rules[k]?.color ?? defaultColor(k)} onChange={(e) => setRule(k, { color: e.target.value })} aria-label={t("graphPersp.colorOf", { kind: kindLabel(k) })} />
                </td>
                <td>
                  <select value={rules[k]?.size ?? "fixed"} onChange={(e) => setRule(k, { size: e.target.value as KindRule["size"] })} aria-label={t("graphPersp.sizeOf", { kind: kindLabel(k) })}>
                    <option value="fixed">{t("graphPersp.size.fixed")}</option>
                    <option value="degree">{t("graphPersp.size.degree")}</option>
                  </select>
                </td>
                <td>
                  <input type="number" min={0.25} max={4} step={0.25} value={rules[k]?.scale ?? 1} onChange={(e) => setRule(k, { scale: Math.min(4, Math.max(0.25, Number(e.target.value) || 1)) })} aria-label={t("graphPersp.scaleOf", { kind: kindLabel(k) })} style={{ inlineSize: 56 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <span role="status" aria-live="polite" data-testid="graph-perspective-status" style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
        {status}
      </span>
    </div>
  );
}
