/**
 * A Jupyter notebook (nbformat 4, https://nbformat.readthedocs.io) read for
 * display, plan W12.F4. Nothing here runs code: an output is classified by
 * the richest MIME type we can show safely, and anything active
 * (`application/javascript`, widget state) becomes text that is shown, not run.
 */

export type NotebookOutput =
  | { kind: "text"; text: string; stream?: "stdout" | "stderr" }
  | { kind: "error"; name: string; text: string }
  | { kind: "image"; mime: string; src: string; alt: string }
  | { kind: "svg"; svg: string }
  | { kind: "html"; html: string }
  | { kind: "markdown"; markdown: string }
  | { kind: "code"; mime: string; text: string };

export interface NotebookCell {
  type: "markdown" | "code" | "raw";
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export interface Notebook {
  language: string;
  nbformat: number;
  cells: NotebookCell[];
}

const join = (s: unknown): string => (Array.isArray(s) ? s.join("") : typeof s === "string" ? s : "");

/** ANSI colour escapes (tracebacks and coloured stdout). */
// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** MIME types shown as code (never executed). */
const ACTIVE_MIMES = ["application/javascript", "text/javascript", "application/vnd.jupyter.widget-view+json", "application/vnd.jupyter.widget-state+json"];

function displayOutput(data: Record<string, unknown>): NotebookOutput {
  for (const mime of IMAGE_MIMES) {
    const b64 = join(data[mime]).replace(/\s+/g, "");
    if (b64 && /^[A-Za-z0-9+/=]+$/.test(b64)) return { kind: "image", mime, src: `data:${mime};base64,${b64}`, alt: join(data["text/plain"]).trim() };
  }
  if (data["image/svg+xml"]) return { kind: "svg", svg: join(data["image/svg+xml"]) };
  if (data["text/html"]) return { kind: "html", html: join(data["text/html"]) };
  if (data["text/markdown"]) return { kind: "markdown", markdown: join(data["text/markdown"]) };
  if (data["text/latex"]) return { kind: "code", mime: "text/latex", text: join(data["text/latex"]) };
  // Active content is shown as what it is (and never run), not hidden behind its text/plain repr.
  for (const mime of ACTIVE_MIMES) if (data[mime] !== undefined) return { kind: "code", mime, text: typeof data[mime] === "string" || Array.isArray(data[mime]) ? join(data[mime]) : JSON.stringify(data[mime], null, 2) };
  if (data["text/plain"] !== undefined) return { kind: "text", text: join(data["text/plain"]) };
  const [mime, value] = Object.entries(data)[0] ?? ["", ""];
  return { kind: "code", mime, text: typeof value === "string" || Array.isArray(value) ? join(value) : JSON.stringify(value, null, 2) };
}

export class NotebookError extends Error {}

/** Parse a notebook for display. nbformat 4 only; older notebooks are named in the error. */
export function parseNotebook(json: string): Notebook {
  let nb: { nbformat?: number; cells?: unknown[]; metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } } };
  try {
    nb = JSON.parse(json);
  } catch {
    throw new NotebookError("not valid JSON");
  }
  if (!nb || typeof nb !== "object") throw new NotebookError("not a notebook");
  if ((nb.nbformat ?? 0) < 4) throw new NotebookError(`nbformat ${nb.nbformat ?? "?"} (only 4 is shown; convert it to a note instead)`);
  const language = nb.metadata?.language_info?.name || nb.metadata?.kernelspec?.language || "python";
  const cells: NotebookCell[] = [];
  for (const raw of Array.isArray(nb.cells) ? nb.cells : []) {
    const c = raw as { cell_type?: string; source?: unknown; execution_count?: number | null; outputs?: unknown[] };
    const type = c.cell_type === "markdown" || c.cell_type === "code" ? c.cell_type : "raw";
    const outputs: NotebookOutput[] = [];
    for (const o of (type === "code" && Array.isArray(c.outputs) ? c.outputs : []) as Array<Record<string, unknown>>) {
      if (o.output_type === "stream") outputs.push({ kind: "text", text: stripAnsi(join(o.text)), stream: o.name === "stderr" ? "stderr" : "stdout" });
      else if (o.output_type === "error") outputs.push({ kind: "error", name: `${join(o.ename)}: ${join(o.evalue)}`, text: stripAnsi(((o.traceback as string[]) ?? []).join("\n")) });
      else if ((o.output_type === "execute_result" || o.output_type === "display_data") && o.data && typeof o.data === "object") outputs.push(displayOutput(o.data as Record<string, unknown>));
    }
    cells.push({ type, source: join(c.source), executionCount: typeof c.execution_count === "number" ? c.execution_count : null, outputs });
  }
  return { language, nbformat: nb.nbformat ?? 4, cells };
}
