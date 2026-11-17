/**
 * "PDF from LaTeX" on the desktop (plan W5.22 step 3, W10.E14): the export's
 * main.tex and files go to Tectonic through the Tauri commands in
 * src-tauri/src/lib.rs (`latex_status`, `latex_pdf`; the logic and its Rust
 * tests are in src-tauri/src/tectonic.rs). The user installs Tectonic. In
 * the browser there is no compiler: the ZIP export stays the way.
 *
 * Network (R8-M1): Lumen sends nothing itself, but Tectonic downloads its TeX
 * support bundle and any package it has not cached from its bundle server
 * (relay.fullyjustified.net), as its own process: the page's CSP and fetch
 * guards cannot see it. So in airplane mode or under local-only it runs with
 * --only-cached (no request; a package it lacks is a TeX error). Otherwise
 * the user is asked once whether Tectonic may download (declined: cache
 * only), and every compile that may download is listed in the privacy ledger.
 */
import type { ZipInput } from "../storage/zip";
import { getAiPolicy } from "../ai/policy";
import { airplaneModeOn } from "../privacy/airplane";
// The latex.* English is registered by ./app.ts (./latexStrings), the only caller of compileLatexPdf.
import { t } from "../i18n";

/** Where Tectonic fetches TeX packages from (its default bundle). */
export const TECTONIC_BUNDLE_URL = "https://relay.fullyjustified.net";
/** The privacy ledger's name for a compile that may download (store/privacy-labels.json lists it). */
export const TECTONIC_LEDGER_REASON = "Tectonic: TeX packages from its bundle server (LaTeX to PDF)";
/** "1": the user allowed Tectonic's downloads; "0": declined (cache only). Asked once. */
export const TECTONIC_CONSENT_KEY = "lumen.latex.tectonicDownloads";

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

export interface CompileDeps {
  invoke?: Invoke;
  /** Airplane mode or local-only: Tectonic may not download (default: the app's switches). */
  offline?: () => boolean;
  /** The one-time question (default: uiConfirm). */
  confirm?: (o: { title: string; message: string; okLabel: string }) => Promise<boolean>;
  /** A ledger entry for a compile that may download (default: recordProcessCall). */
  record?: (url: string, reason: string) => void;
  store?: Pick<Storage, "getItem" | "setItem"> | null;
}

const appOffline = () => airplaneModeOn() || getAiPolicy() === "local-only";

function defaultStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // why: storage blocked: ask again next time
  }
}

/** May Tectonic download this time? Never offline; otherwise the user's one answer (asked once). */
export async function tectonicMayDownload(deps: CompileDeps = {}): Promise<boolean> {
  if ((deps.offline ?? appOffline)()) return false;
  const store = deps.store === undefined ? defaultStore() : deps.store;
  const saved = store?.getItem(TECTONIC_CONSENT_KEY);
  if (saved === "1" || saved === "0") return saved === "1";
  const confirm = deps.confirm ?? (async (o) => (await import("../ui/PromptDialog")).uiConfirm(o));
  const ok = await confirm({ title: t("latex.pdf.consent.title"), message: t("latex.pdf.consent.message", { host: new URL(TECTONIC_BUNDLE_URL).host }), okLabel: t("latex.pdf.consent.ok") });
  try {
    store?.setItem(TECTONIC_CONSENT_KEY, ok ? "1" : "0");
  } catch {
    /* why: storage full or blocked: the answer holds for this compile */
  }
  return ok;
}

/** The export's files (main.tex first) → the PDF's bytes; throws LatexCompileError with the log's errors. */
export async function compileLatexPdf(files: ZipInput[], deps: CompileDeps = {}): Promise<Uint8Array> {
  const main = files.find((f) => f.name === "main.tex");
  if (!main) throw new Error("no main.tex");
  const enc = new TextEncoder();
  const rest = files.filter((f) => f !== main && f.name !== "README.txt").map((f) => ({ name: f.name, data: Array.from(typeof f.data === "string" ? enc.encode(f.data) : f.data) }));
  const invoke = deps.invoke ?? (await tauriInvoke());
  const download = await tectonicMayDownload(deps);
  if (download) {
    const record = deps.record ?? ((url: string, reason: string) => void import("../ai/privacyLedger").then((m) => m.recordProcessCall(url, reason, 0, true)));
    record(TECTONIC_BUNDLE_URL, TECTONIC_LEDGER_REASON);
  }
  try {
    const out = await invoke<ArrayBuffer | number[]>("latex_pdf", { tex: typeof main.data === "string" ? main.data : new TextDecoder().decode(main.data), files: rest, offline: !download });
    return out instanceof ArrayBuffer ? new Uint8Array(out) : Uint8Array.from(out);
  } catch (e) {
    const f = e as Failure;
    if (f && typeof f === "object" && f.kind === "tex") throw new LatexCompileError(f.errors ?? [], f.log_tail ?? "");
    if (f && typeof f === "object" && f.kind === "no-tectonic") throw new Error("Tectonic is not installed");
    if (f && typeof f === "object" && f.kind === "other") throw new Error(f.message);
    throw e;
  }
}
