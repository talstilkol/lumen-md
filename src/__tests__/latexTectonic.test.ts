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
import "../latex/latexStrings"; // the latex.* English, as ./app.ts registers it before compiling
import { LatexCompileError, TECTONIC_BUNDLE_URL, TECTONIC_CONSENT_KEY, TECTONIC_LEDGER_REASON, compileLatexPdf, formatTexError, latexPdfStatus, type CompileDeps, type Invoke } from "../latex/tectonicDesktop";

const ROOT = join(__dirname, "..", "..");
const files = [
  { name: "main.tex", data: "\\documentclass{article}\\begin{document}שלום\\end{document}" },
  { name: "references.bib", data: "@book{k, title={T}}" },
  { name: "images/a.png", data: new Uint8Array([0x89, 0x50]), store: true },
  { name: "README.txt", data: "Compile with latexmk" },
];

// The network side is its own describe block below; here Tectonic stays offline (cache only).
const OFF: CompileDeps = { offline: () => true };

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
      ...OFF,
      invoke: (async (cmd: string, args?: Record<string, unknown>) => {
        expect(cmd).toBe("latex_pdf");
        sent = args;
        return new TextEncoder().encode("%PDF-1.7").buffer;
      }) as Invoke,
    });
    expect(new TextDecoder().decode(pdf)).toBe("%PDF-1.7");
    expect(sent!.tex).toBe(files[0].data);
    expect(sent!.offline).toBe(true);
    expect(sent!.files).toEqual([
      { name: "references.bib", data: Array.from(new TextEncoder().encode("@book{k, title={T}}")) },
      { name: "images/a.png", data: [0x89, 0x50] },
    ]);
  });

  it("TeX's errors come back with their main.tex lines", async () => {
    const invoke = (async () => {
      throw { kind: "tex", errors: [{ line: 7, message: "Undefined control sequence." }, { line: null, message: "Emergency stop." }], log_tail: "… l.7 \\foo" };
    }) as Invoke;
    const err = await compileLatexPdf(files, { ...OFF, invoke }).catch((e) => e);
    expect(err).toBeInstanceOf(LatexCompileError);
    expect((err as LatexCompileError).errors.map(formatTexError)).toEqual(["main.tex:7: Undefined control sequence.", "Emergency stop."]);
    expect((err as LatexCompileError).logTail).toContain("l.7");
    await expect(compileLatexPdf(files, { ...OFF, invoke: (async () => Promise.reject({ kind: "no-tectonic" })) as Invoke })).rejects.toThrow(/not installed/);
    await expect(compileLatexPdf([{ name: "x.tex", data: "" }], { ...OFF, invoke })).rejects.toThrow(/main\.tex/);
  });
});

describe("Tectonic's own downloads (R8-M1)", () => {
  const ok = new TextEncoder().encode("%PDF").buffer;
  const run = async (deps: Partial<CompileDeps>) => {
    let offline: unknown;
    const recorded: string[] = [];
    const invoke = (async (_c: string, a?: Record<string, unknown>) => ((offline = a?.offline), ok)) as Invoke;
    await compileLatexPdf(files, { invoke, record: (url, reason) => recorded.push(`${url} ${reason}`), ...deps });
    return { offline, recorded };
  };
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("airplane mode or local-only: cache only, nothing asked, nothing recorded", async () => {
    const confirm = async () => {
      throw new Error("asked");
    };
    expect(await run({ offline: () => true, confirm, store: mem() })).toEqual({ offline: true, recorded: [] });
  });

  it("otherwise asked once: allowed downloads are listed in the ledger on every compile; declined stays cache-only", async () => {
    const store = mem();
    let asked = 0;
    const yes = async (o: { message: string }) => (asked++, expect(o.message).toContain("relay.fullyjustified.net"), true);
    expect(await run({ offline: () => false, confirm: yes, store })).toEqual({ offline: false, recorded: [`${TECTONIC_BUNDLE_URL} ${TECTONIC_LEDGER_REASON}`] });
    expect(await run({ offline: () => false, confirm: yes, store })).toEqual({ offline: false, recorded: [`${TECTONIC_BUNDLE_URL} ${TECTONIC_LEDGER_REASON}`] });
    expect(asked).toBe(1);
    expect(store.m.get(TECTONIC_CONSENT_KEY)).toBe("1");
    const no = mem();
    expect(await run({ offline: () => false, confirm: async () => false, store: no })).toEqual({ offline: true, recorded: [] });
    expect(no.m.get(TECTONIC_CONSENT_KEY)).toBe("0");
  });

  it("the route is documented: privacy labels, PRIVACY.md and PRIVACY.he.md name it", () => {
    for (const f of ["store/privacy-labels.json", "store/privacy-answers.md", "PRIVACY.md", "PRIVACY.he.md"]) expect(readFileSync(join(ROOT, f), "utf8"), f).toContain(f.startsWith("store/privacy-answers") ? "LaTeX to PDF with Tectonic" : TECTONIC_LEDGER_REASON);
  });
});

describe("the Tauri side", () => {
  it("lib.rs registers both commands and compiles through tectonic.rs, never with shell escape", () => {
    const lib = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
    expect(lib).toMatch(/^mod tectonic;$/m);
    expect(lib).toMatch(/latex_status,\s*latex_pdf,/);
    // D1 §5: the call picks its timeout from the warm marker (10 min for the first online download, 120 s after).
    expect(lib).toMatch(/tectonic::compile_with_marker\(&bin, &tex, &files, &work, offline, marker\.as_deref\(\)\)/);
    expect(lib).toMatch(/app_cache_dir\(\)\.ok\(\)\.map\(\|d\| d\.join\(tectonic::WARM_MARKER\)\)/);
    // A page that does not say "online" gets the cache only (R8-M1).
    expect(lib).toMatch(/offline\.unwrap_or\(true\)/);
    const core = readFileSync(join(ROOT, "src-tauri/src/tectonic.rs"), "utf8");
    expect(core).toMatch(/"--untrusted"\.into\(\)/);
    expect(core).toMatch(/"--only-cached"\.into\(\)/);
    expect(core).toMatch(/b\.mode\(0o700\)/);
    expect(core).not.toMatch(/shell-escape/);
    // compile_with_marker goes through compile() with the timeout compile_timeout() picks: never an unbounded wait.
    expect(core).toMatch(/let out = compile\(bin, tex, files, work, offline, compile_timeout\(offline, warm\)\);/);
    expect(core).toMatch(/if offline \|\| warm \{\s*COMPILE_TIMEOUT\s*\} else \{\s*FIRST_DOWNLOAD_TIMEOUT\s*\}/);
  });
});
