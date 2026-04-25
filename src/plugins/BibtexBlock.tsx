import { useMemo } from "react";
import { BookOpen } from "lucide-react";
import { formatEntry, parseBibtex } from "../data/bibtex";
import { t } from "../i18n";

interface Props {
  source: string;
}

export default function BibtexBlock({ source }: Props) {
  const entries = useMemo(() => parseBibtex(source), [source]);

  if (entries.length === 0) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ {t("bibtex.noEntries")}
        </div>
      </div>
    );
  }

  return (
    <div className="chart-block bibliography">
      <div className="chart-block-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <BookOpen size={13} style={{ opacity: 0.7 }} />
          {t("bibtex.references", { n: entries.length })}
        </span>
      </div>
      <ol className="bibliography-list">
        {entries.map((entry, i) => {
          const num = i + 1;
          const url =
            entry.fields.url ??
            (entry.fields.doi ? `https://doi.org/${entry.fields.doi}` : null);
          return (
            <li
              key={entry.key}
              id={`cite-${entry.key}`}
              className="bibliography-item"
            >
              <span className="bibliography-marker">[{num}]</span>
              <span className="bibliography-text">
                {entry.fields.author && (
                  <>
                    <span style={{ fontWeight: 500 }}>
                      {entry.fields.author}
                    </span>
                    {". "}
                  </>
                )}
                {entry.fields.title && (
                  <>
                    <em>{entry.fields.title}</em>
                    {". "}
                  </>
                )}
                {(entry.fields.journal ||
                  entry.fields.booktitle ||
                  entry.fields.publisher ||
                  entry.fields.school ||
                  entry.fields.institution) && (
                  <>
                    {entry.fields.journal ||
                      entry.fields.booktitle ||
                      entry.fields.publisher ||
                      entry.fields.school ||
                      entry.fields.institution}
                    {entry.fields.year ? `, ${entry.fields.year}` : ""}
                    {". "}
                  </>
                )}
                {!entry.fields.journal &&
                  !entry.fields.booktitle &&
                  !entry.fields.publisher &&
                  entry.fields.year && (
                    <>
                      {entry.fields.year}
                      {". "}
                    </>
                  )}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {entry.fields.doi ? `doi:${entry.fields.doi}` : t("bibtex.link")}
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {/* Pre-format also exposed via title attribute for quick copy */}
      <noscript title={entries.map((e, i) => formatEntry(e, i + 1)).join("\n")} />
    </div>
  );
}
