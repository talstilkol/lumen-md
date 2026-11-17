/**
 * The bilingual reader (W13.R12): two columns, interlinear (each verse with
 * its translation under it), or the source alone — switched with the
 * buttons or the keys 1 / 2 / 3. The source column comes first in its own
 * reading direction (a Hebrew source on the right). It says which kind of
 * translation it shows: an official version and its licence, or a machine
 * translation made on this device.
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { registerEnglish, t } from "../i18n";
import english from "../i18n/lazy/bilingual.json";
import { BILINGUAL_MODES, readMode, saveMode, type Bilingual, type BilingualMode } from "../reading/bilingual/bilingual";
import { readingText } from "../reading/profileCore";

registerEnglish(english);

interface Props {
  data: Bilingual;
  initialMode?: BilingualMode;
}

const muted = { color: "hsl(var(--fg-muted))" } as const;

export function BilingualView({ data, initialMode }: Props) {
  const [mode, setMode] = useState<BilingualMode>(initialMode ?? readMode());
  useEffect(() => saveMode(mode), [mode]);
  const { source: s, target: tg } = data;

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = ["1", "2", "3"].indexOf(e.key);
    if (i < 0) return;
    e.preventDefault();
    setMode(BILINGUAL_MODES[i]);
  };

  const versionNote =
    data.kind === "official"
      ? t("bilingual.official", { source: s.title, target: tg.title, license: tg.license ?? "" })
      : t("bilingual.machine", { layer: tg.title ? t(`mt.layer.name.${tg.title}`) : "" });

  return (
    <section aria-labelledby="bi-title" data-testid="bilingual-view" data-mode={mode} onKeyDown={onKey} style={{ display: "grid", gap: 10, fontSize: "var(--reading-size, inherit)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <h2 id="bi-title" lang={s.lang} dir={s.dir} style={{ margin: 0, fontSize: 18, flex: 1 }}>
          {data.title}
        </h2>
        <div role="group" aria-label={t("bilingual.layout")} style={{ display: "inline-flex", gap: 2 }}>
          {BILINGUAL_MODES.map((m, i) => (
            <button key={m} type="button" data-testid={`bi-mode-${m}`} aria-pressed={mode === m} aria-keyshortcuts={String(i + 1)} onClick={() => setMode(m)} style={{ fontWeight: mode === m ? 700 : 400, textDecoration: mode === m ? "underline" : "none" }}>
              {t(`bilingual.mode.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <p data-testid="bi-version" style={{ margin: 0, fontSize: 12, ...muted }}>
        {versionNote}
        {data.unmatched > 0 && ` ${t("bilingual.unmatched", { count: data.unmatched })}`}
      </p>
      {mode === "columns" && (
        <div role="table" aria-label={t("bilingual.table")} dir={s.dir} style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "8px 16px", alignItems: "start" }}>
          <div role="row" style={{ display: "contents" }}>
            <span role="columnheader" style={{ ...muted, fontSize: 12 }}>
              {t("bilingual.verse")}
            </span>
            <span role="columnheader" style={{ ...muted, fontSize: 12 }}>
              {t("bilingual.source")}
            </span>
            <span role="columnheader" style={{ ...muted, fontSize: 12 }}>
              {t("bilingual.translation")}
            </span>
          </div>
          {data.rows.map((r) => (
            <div role="row" key={r.n} data-testid="bi-row" data-verse={r.n} style={{ display: "contents" }}>
              <span role="rowheader" style={{ ...muted, fontSize: 12 }}>
                {r.label}
              </span>
              <div role="cell" data-testid="bi-src" lang={s.lang} dir={s.dir} style={{ ...readingText("1.1em", 1.75) }}>
                {r.source}
              </div>
              <div role="cell" data-testid="bi-tgt" lang={tg.lang} dir={tg.dir} style={{ ...readingText(undefined, 1.6), opacity: r.stale ? 0.6 : 1 }}>
                {r.stale && <span style={{ fontSize: 10, marginInlineEnd: 6 }}>{t("bilingual.stale")}</span>}
                {r.target ?? <span style={muted}>{t("bilingual.missing")}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {mode === "interlinear" && (
        <ol aria-label={t("bilingual.table")} dir={s.dir} style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 14 }}>
          {data.rows.map((r) => (
            <li key={r.n} data-testid="bi-row" data-verse={r.n} aria-label={t("bilingual.verseN", { n: r.label })}>
              {(r.sentences ?? [[r.source, r.target ?? ""]]).map(([a, b], i) => (
                <div key={i} style={{ marginBlockEnd: 4 }}>
                  <div data-testid="bi-src" lang={s.lang} dir={s.dir} style={{ ...readingText("1.15em", 1.75) }}>
                    {i === 0 && (
                      <span aria-hidden="true" style={{ ...muted, fontSize: 12, marginInlineEnd: 8 }}>
                        {r.label}
                      </span>
                    )}
                    {a}
                  </div>
                  <div data-testid="bi-tgt" lang={tg.lang} dir={tg.dir} style={{ ...readingText("0.92em", 1.5), color: "hsl(var(--fg-muted))", textAlign: s.dir === "rtl" ? "right" : "left", opacity: r.stale ? 0.6 : 1 }}>
                    {b || (r.target === null ? t("bilingual.missing") : "")}
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ol>
      )}
      {mode === "source" && (
        <div lang={s.lang} dir={s.dir} style={{ fontSize: "1.15em", lineHeight: 1.8 }}>
          {data.rows.map((r) => (
            <p key={r.n} data-testid="bi-row" data-verse={r.n} style={{ margin: "0 0 6px" }}>
              <span aria-hidden="true" style={{ ...muted, fontSize: 12, marginInlineEnd: 8 }}>
                {r.label}
              </span>
              <span data-testid="bi-src">{r.source}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

export default BilingualView;
