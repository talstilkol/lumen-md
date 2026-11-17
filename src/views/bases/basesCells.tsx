/**
 * The cells of a base's views (plan W1.11): files and links open, lists join,
 * true / false as ✓ / ✗. Out of BasesBlock.tsx to keep it under 800 lines.
 */
import type { JSX, ReactNode } from "react";
import type { BaseResult, BaseRow } from "./base";
import { isTagged, toText, type BasesFile, type BValue } from "./values";

export function openFile(path: string) {
  window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } }));
}

export function FileLink({ path, label }: { path: string; label: string }) {
  return (
    <a
      href={`#${encodeURIComponent(path)}`}
      dir="auto"
      onClick={(e) => {
        e.preventDefault();
        openFile(path);
      }}
      style={{ color: "hsl(var(--accent))", textDecoration: "none", fontWeight: 500 }}
    >
      {label}
    </a>
  );
}

/** One value in a cell: files and links open, lists join, true / false as ✓ / ✗. */
export function Cell({ value, files }: { value: BValue; files: readonly BasesFile[] }): JSX.Element | null {
  if (value === null) return null;
  if (typeof value === "boolean") return <span aria-label={String(value)}>{value ? "✓" : "✗"}</span>;
  if (Array.isArray(value))
    return (
      <>
        {value.map((v, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <Cell value={v} files={files} />
          </span>
        ))}
      </>
    );
  if (isTagged(value)) {
    if (value.$ === "file") return <FileLink path={value.file.path} label={value.file.basename} />;
    if (value.$ === "link") {
      const target = files.find((f) => f.path === value.path || f.basename === value.path || f.path.replace(/\.md$/i, "") === value.path);
      return target ? <FileLink path={target.path} label={toText(value)} /> : <span dir="auto">{toText(value)}</span>;
    }
    if (value.$ === "image" && /^https:\/\//i.test(value.src)) return <img src={value.src} alt="" loading="lazy" style={{ maxInlineSize: 120, maxBlockSize: 80 }} />;
  }
  return <span dir="auto">{toText(value)}</span>;
}

export function nameCell(row: BaseRow, id: string, files: readonly BasesFile[]): ReactNode {
  // file.name in the first column opens the note, as in Obsidian.
  if (id === "file.name" || id === "file.basename") return <FileLink path={row.file.path} label={row.file.ext === "md" ? row.file.basename : row.file.name} />;
  return <Cell value={row.cells[id]} files={files} />;
}

export interface ViewProps {
  result: BaseResult;
  files: readonly BasesFile[];
}
