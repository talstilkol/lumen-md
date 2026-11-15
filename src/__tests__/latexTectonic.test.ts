/**
 * W10.E14 (plan W5.22 step 3): "PDF from LaTeX" on the desktop. The Rust
 * side (finding Tectonic, compiling with --untrusted, reading TeX's errors
 * and their lines, a stand-in binary) is tested in src-tauri/src/tectonic.rs
 * (`rustc --edition 2021 --test`). Here: the page side of the two Tauri
 * commands, with the IPC answering as lib.rs's latex_status / latex_pdf do.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LatexCompileError, compileLatexPdf, formatTexError, latexPdfStatus, type Invoke } from "../latex/tectonicDesktop";

const ROOT = join(__dirname, "..", "..");
const files = [
  { name: "main.tex", data: "\\documentclass{article}\\begin{document}שלום\\end{document}" },
  { name: "references.bib", data: "@book{k, title={T}}" },
  { name: "images/a.png", data: new Uint8Array([0x89, 0x50]), store: true },
  { name: "README.txt", data: "Compile with latexmk" },
];

describe("latex_status", () => {
  it("web in the browser, no-tectonic or ready on the desktop", async () => {
    expect(await latexPdfStatus({ desktop: false })).toEqual({ kind: "web" });
    const invoke = (tectonic: string | null): Invoke => (async (cmd: string) => (cmd === "latex_status" ? { tectonic } : null)) as Invoke;
    expect(await latexPdfStatus({ desktop: true, invoke: invoke(null) })).toEqual({ kind: "no-tectonic" });
    expect(await latexPdfStatus({ desktop: true, invoke: invoke("/opt/homebrew/bin/tectonic") })).toEqual({ kind: "ready", tectonic: "/opt/homebrew/bin/tectonic" });
  });
});

describe("latex_pdf", () => {
  it("sends main.tex as text and the other files (not the README) as bytes; the PDF comes back as bytes", async () => {
    let sent: Record<string, unknown> | undefined;
    const pdf = await compileLatexPdf(files, {
      invoke: (async (cmd: string, args?: Record<string, unknown>) => {
        expect(cmd).toBe("latex_pdf");
        sent = args;
        return new TextEncoder().encode("%PDF-1.7").buffer;
      }) as Invoke,
    });
    expect(new TextDecoder().decode(pdf)).toBe("%PDF-1.7");
    expect(sent!.tex).toBe(files[0].data);
    expect(sent!.files).toEqual([
      { name: "references.bib", data: Array.from(new TextEncoder().encode("@book{k, title={T}}")) },
      { name: "images/a.png", data: [0x89, 0x50] },
    ]);
  });

  it("TeX's errors come back with their main.tex lines", async () => {
    const invoke = (async () => {
      throw { kind: "tex", errors: [{ line: 7, message: "Undefined control sequence." }, { line: null, message: "Emergency stop." }], log_tail: "… l.7 \\foo" };
    }) as Invoke;
    const err = await compileLatexPdf(files, { invoke }).catch((e) => e);
    expect(err).toBeInstanceOf(LatexCompileError);
    expect((err as LatexCompileError).errors.map(formatTexError)).toEqual(["main.tex:7: Undefined control sequence.", "Emergency stop."]);
    expect((err as LatexCompileError).logTail).toContain("l.7");
    await expect(compileLatexPdf(files, { invoke: (async () => Promise.reject({ kind: "no-tectonic" })) as Invoke })).rejects.toThrow(/not installed/);
    await expect(compileLatexPdf([{ name: "x.tex", data: "" }], { invoke })).rejects.toThrow(/main\.tex/);
  });
});

describe("the Tauri side", () => {
  it("lib.rs registers both commands and compiles through tectonic.rs, never with shell escape", () => {
    const lib = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
    expect(lib).toMatch(/^mod tectonic;$/m);
    expect(lib).toMatch(/latex_status,\s*latex_pdf,/);
    expect(lib).toMatch(/tectonic::compile\(&bin, &tex, &files, &work\)/);
    const core = readFileSync(join(ROOT, "src-tauri/src/tectonic.rs"), "utf8");
    expect(core).toMatch(/"--untrusted"\.into\(\)/);
    expect(core).not.toMatch(/shell-escape/);
  });
});
