/**
 * A Jupyter notebook shown as it is, without converting it (plan W12.F4):
 * markdown cells rendered, code cells highlighted with their execution
 * count, and outputs: text, errors, images, SVG and HTML tables.
 *
 * Nothing runs. SVG and HTML go through the app's sanitizer (the `lumen`
 * Trusted Types policy, DOMPurify): `<script>`, event handlers and
 * `javascript:` URLs are removed before they reach the DOM. JavaScript and
 * widget outputs are shown as code, labelled as not run.
 */
import "./strings";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { toTrustedHTML } from "../lib/trustedTypes";
import { localOnlyHtml } from "./notebookHtml";
import type { Notebook, NotebookCell, NotebookOutput } from "./notebook";
import { EmptyState, learnHow } from "../ui/EmptyState";

type Render = (markdown: string) => Promise<ReactNode>;

/** The app's renderer, loaded on first use (Shiki for code, KaTeX for math); a plain `<pre>` until then or if it fails. */
const defaultRender: Render = async (markdown) => {
  const { renderMarkdown } = await import("../renderer/pipeline");
  return renderMarkdown(markdown, () => document.documentElement.classList.contains("dark"));
};

function Rendered({ markdown, render, fallback }: { markdown: string; render: Render; fallback: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  useEffect(() => {
    let live = true;
    render(markdown).then(
      (n) => live && setNode(n),
      () => live && setNode(null),
    );
    return () => {
      live = false;
    };
  }, [markdown, render]);
  return <>{node ?? fallback}</>;
}

function fence(source: string, lang: string): string {
  const longest = Math.max(2, ...(source.match(/`+/g) ?? []).map((m) => m.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${source}\n${f}`;
}

/** Sanitized HTML or SVG output, with every remote reference removed first (./notebookHtml). */
function Markup({ markup, kind }: { markup: string; kind: "html" | "svg" }) {
  const safe = useMemo(() => localOnlyHtml(markup, kind, t("fileViewer.nb.image")), [markup, kind]);
  return (
    <>
      <div
        className={`nb-out nb-${kind}`}
        dir={kind === "html" ? "auto" : undefined}
        dangerouslySetInnerHTML={{ __html: toTrustedHTML(safe.html, kind) as string }}
      />
      {safe.blocked > 0 && (
        <p className="nb-blocked" role="note">
          {t("fileViewer.nb.blocked", { n: safe.blocked })}
        </p>
      )}
    </>
  );
}

function Output({ out, render }: { out: NotebookOutput; render: Render }) {
  switch (out.kind) {
    case "text":
      return <pre className={`nb-out nb-stream nb-${out.stream ?? "result"}`}>{out.text}</pre>;
    case "error":
      return (
        <pre className="nb-out nb-error" role="note" aria-label={out.name}>
          {out.text || out.name}
        </pre>
      );
    case "image":
      return <img className="nb-out nb-image" src={out.src} alt={out.alt || t("fileViewer.nb.image")} />;
    case "svg":
      return <Markup markup={out.svg} kind="svg" />;
    case "html":
      return <Markup markup={out.html} kind="html" />;
    case "markdown":
      return (
        <div className="nb-out nb-md" dir="auto">
          <Rendered markdown={out.markdown} render={render} fallback={<pre>{out.markdown}</pre>} />
        </div>
      );
    case "code":
      return (
        <figure className="nb-out nb-inactive">
          <figcaption>{t("fileViewer.nb.notRun", { mime: out.mime })}</figcaption>
          <pre>{out.text}</pre>
        </figure>
      );
  }
}

function Cell({ cell, language, render }: { cell: NotebookCell; language: string; render: Render }) {
  if (cell.type === "markdown")
    return (
      <section className="nb-cell nb-markdown" dir="auto">
        <Rendered markdown={cell.source} render={render} fallback={<pre className="nb-plain">{cell.source}</pre>} />
      </section>
    );
  if (cell.type === "raw")
    return (
      <section className="nb-cell nb-raw">
        <pre dir="ltr">{cell.source}</pre>
      </section>
    );
  return (
    <section className="nb-cell nb-code">
      <div className="nb-prompt" aria-label={t("fileViewer.nb.in", { n: cell.executionCount ?? " " })}>
        [{cell.executionCount ?? " "}]
      </div>
      <div className="nb-body">
        <div className="nb-source" dir="ltr">
          <Rendered markdown={fence(cell.source, language)} render={render} fallback={<pre>{cell.source}</pre>} />
        </div>
        {cell.outputs.map((o, i) => (
          <Output key={i} out={o} render={render} />
        ))}
      </div>
    </section>
  );
}

export function NotebookView({ notebook, render = defaultRender }: { notebook: Notebook; render?: Render }) {
  return (
    <div className="nb-view" data-testid="notebook-view">
      {notebook.cells.length === 0 && <EmptyState message={t("fileViewer.nb.empty")} action={learnHow("workspace/file-viewers")} />}
      {notebook.cells.map((c, i) => (
        <Cell key={i} cell={c} language={notebook.language} render={render} />
      ))}
    </div>
  );
}
