/**
 * The built-in "source" type (מקור), plan W12.X2: a book, article or site
 * the user reads, with a reading status, progress and a personal rating.
 *
 * Everything lives in the note's frontmatter (the acceptance: no field
 * outside it), as an ordinary type of W12.T1. A vault file
 * `.lumen/types/source.yaml` replaces it, as for every built-in type.
 *
 *   type: source
 *   kind: book            # book | article | website
 *   status: reading       # to-read | reading | done
 *   progress: 25          # percent
 *   page: 50              # where the reader is (PDF page, EPUB chapter)
 *   pages: 200            # length (PDF pages, EPUB chapters)
 *   rating: 4             # 1–5, the user's own
 *   file: "[[papers/x.pdf]]"   # the PDF or EPUB it is read in
 *   citekey: cohen2020    # its key in the citation library (Zotero)
 */
import { typeDefFromObject, type TypeDef } from "../types/typeSchema";

export const SOURCE_TYPE_ID = "source";

export const SOURCE_KINDS = ["book", "article", "website"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const READING_STATUSES = ["to-read", "reading", "done"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

/** The type as a type file would declare it (YAML-shaped). */
export const SOURCE_TYPE_OBJECT = {
  label: { he: "מקור", en: "Source" },
  tag: "source",
  fields: {
    // `status` is the type's first select: its Base gets a kanban view by it (W12.T3).
    status: { type: "select", options: [...READING_STATUSES], default: "to-read", pinned: true, label: { he: "מצב", en: "Status" } },
    kind: { type: "select", options: [...SOURCE_KINDS], default: "book", pinned: true, label: { he: "סוג", en: "Kind" } },
    author: { type: "text", pinned: true, label: { he: "מחבר", en: "Author" } },
    progress: { type: "number", default: 0, pinned: true, label: { he: "התקדמות (%)", en: "Progress (%)" } },
    rating: { type: "number", label: { he: "דירוג", en: "Rating" } },
    page: { type: "number", label: { he: "עמוד", en: "Page" } },
    pages: { type: "number", label: { he: "עמודים", en: "Pages" } },
    year: { type: "text", label: { he: "שנה", en: "Year" } },
    url: { type: "url", label: { he: "קישור", en: "Link" } },
    file: { type: "text", label: { he: "קובץ", en: "File" } },
    citekey: { type: "text", label: { he: "מפתח ציטוט", en: "Cite key" } },
    finished: { type: "date", label: { he: "סיום", en: "Finished" } },
  },
} as const;

/** The built-in source type. */
export function sourceTypeDef(): TypeDef {
  const parsed = typeDefFromObject(SOURCE_TYPE_ID, SOURCE_TYPE_OBJECT, "builtin:reading-list");
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.type;
}
