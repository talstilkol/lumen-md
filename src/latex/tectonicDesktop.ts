/**
 * "PDF from LaTeX" on the desktop (plan W5.22 step 3, W10.E14): the export's
 * main.tex and files go to Tectonic through the Tauri commands in
 * src-tauri/src/lib.rs (`latex_status`, `latex_pdf`; the logic and its Rust
 * tests are in src-tauri/src/tectonic.rs). The user installs Tectonic;
 * nothing is downloaded or sent anywhere. In the browser there is no
 * compiler: the ZIP export stays the way.
 */
import type { ZipInput } from "../storage/zip";

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriInvoke(): Promise<Invoke> {
  return (await import("@tauri-apps/api/core")).invoke as Invoke;
}

export type LatexPdfStatus = { kind: "web" } | { kind: "no-tectonic" } | { kind: "ready"; tectonic: string };

export async function latexPdfStatus(deps: { desktop?: boolean; invoke?: Invoke } = {}): Promise<LatexPdfStatus> {
  if (!(deps.desktop ?? isTauri())) return { kind: "web" };
  const invoke = deps.invoke ?? (await tauriInvoke());
  const s = await invoke<{ tectonic: string | null }>("latex_status");
  return s.tectonic ? { kind: "ready", tectonic: s.tectonic } : { kind: "no-tectonic" };
}

export interface TexError {
  line: number | null;
  message: string;
}

/** TeX failed: its errors with the main.tex lines, and the end of its log. */
export class LatexCompileError extends Error {
  constructor(
    readonly errors: TexError[],
    readonly logTail: string,
  ) {
    super(errors.map(formatTexError).join("\n") || "LaTeX failed");
    this.name = "LatexCompileError";
  }
}

export const formatTexError = (e: TexError): string => (e.line ? `main.tex:${e.line}: ${e.message}` : e.message);

type Failure = { kind: "no-tectonic" } | { kind: "tex"; errors: TexError[]; log_tail: string } | { kind: "other"; message: string };

/** The export's files (main.tex first) → the PDF's bytes; throws LatexCompileError with the log's errors. */
export async function compileLatexPdf(files: ZipInput[], deps: { invoke?: Invoke } = {}): Promise<Uint8Array> {
  const main = files.find((f) => f.name === "main.tex");
  if (!main) throw new Error("no main.tex");
  const enc = new TextEncoder();
  const rest = files.filter((f) => f !== main && f.name !== "README.txt").map((f) => ({ name: f.name, data: Array.from(typeof f.data === "string" ? enc.encode(f.data) : f.data) }));
  const invoke = deps.invoke ?? (await tauriInvoke());
  try {
    const out = await invoke<ArrayBuffer | number[]>("latex_pdf", { tex: typeof main.data === "string" ? main.data : new TextDecoder().decode(main.data), files: rest });
    return out instanceof ArrayBuffer ? new Uint8Array(out) : Uint8Array.from(out);
  } catch (e) {
    const f = e as Failure;
    if (f && typeof f === "object" && f.kind === "tex") throw new LatexCompileError(f.errors ?? [], f.log_tail ?? "");
    if (f && typeof f === "object" && f.kind === "no-tectonic") throw new Error("Tectonic is not installed");
    if (f && typeof f === "object" && f.kind === "other") throw new Error(f.message);
    throw e;
  }
}
