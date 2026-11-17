/**
 * The settings search's ranked results (plan W13.E4): a listbox under the
 * search field, driven from the field itself (combobox pattern: ↑/↓ move
 * the active option, Enter opens it, Home/End jump), so the keyboard never
 * leaves the field until a setting is picked.
 *
 * Each result names the setting, then where it lives (the tab, or the
 * plugin). The matched part of the label is highlighted, niqqud and accents
 * included (W13.E3 `highlightParts`).
 */
import React, { useEffect, useRef } from "react";
import { t } from "../../i18n";
import { highlightParts } from "../../text/filterMatch";
import type { SettingsHit } from "../../settings/settingsSearch";
import { EmptyState, learnHow } from "../EmptyState";

interface Props {
  id: string;
  hits: readonly SettingsHit[];
  query: string;
  active: number;
  onActive: (i: number) => void;
  onOpen: (hit: SettingsHit) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export const optionId = (listId: string, i: number) => `${listId}-opt-${i}`;

const MARK: React.CSSProperties = { background: "hsl(var(--accent) / 0.25)", color: "hsl(var(--fg))", padding: 0, borderRadius: 2 };

export function SettingsResults({ id, hits, query, active, onActive, onOpen, onKeyDown }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  // The active option stays in view as the arrows move it.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(id, active))}`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [active, id]);

  if (!hits.length) {
    return (
      <EmptyState testId="settings-results-none" style={{ padding: "8px 16px", fontSize: 13 }} message={t("settingsSearch.none", { q: query.trim() })} action={learnHow("editor/settings")} />
    );
  }
  return (
    <div style={{ borderBottom: "1px solid hsl(var(--border))", padding: "6px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "0 8px 4px", fontSize: 11, color: "hsl(var(--fg-muted))" }}>
        <span id={`${id}-label`}>{t("settingsSearch.results")}</span>
        <span aria-hidden="true">{t("settingsSearch.hint")}</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {t("settingsSearch.count", { n: hits.length })}
      </p>
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-labelledby={`${id}-label`}
        aria-activedescendant={optionId(id, active)}
        // Scrollable, so it takes focus too (axe scrollable-region-focusable); the same keys work here.
        tabIndex={0}
        data-testid="settings-results"
        onKeyDown={onKeyDown}
        style={{ maxHeight: "34vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}
      >
        {hits.map((h, i) => {
          const detail = h.item.kind === "tab" ? t("settingsSearch.tabHit") : h.item.kind === "plugin" ? t("settingsSearch.pluginHit", { name: h.item.detail }) : h.item.detail;
          return (
            <div
              key={h.item.id}
              id={optionId(id, i)}
              role="option"
              aria-selected={i === active}
              data-result={h.item.id}
              onMouseMove={() => i !== active && onActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onOpen(h)}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
                background: i === active ? "hsl(var(--accent) / 0.12)" : "transparent",
                outline: i === active ? "1px solid hsl(var(--accent) / 0.5)" : "none",
                color: "hsl(var(--fg))",
              }}
            >
              <span dir="auto" style={{ flex: 1, minWidth: 0 }}>
                {highlightParts(h.item.label, query).map((p, j) => (p.hit ? <mark key={j} style={MARK}>{p.text}</mark> : <React.Fragment key={j}>{p.text}</React.Fragment>))}
              </span>
              <span dir="auto" style={{ fontSize: 11, color: "hsl(var(--fg-muted))", whiteSpace: "nowrap" }}>
                {detail}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
