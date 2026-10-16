/**
 * A minimal TypeScript language service over Markdown code blocks. Each
 * block is its own module-scoped virtual file, checked in strict mode
 * against the ES2022 + DOM libs. Takes the `typescript` module and the lib
 * files as parameters so it runs both in the worker (bundled) and in tests
 * (read from node_modules).
 */
import type * as TS from "typescript";

export interface BlockInput {
  id: string;
  code: string;
  tsx: boolean;
}

export interface TsDiagnostic {
  id: string;
  start: number;
  length: number;
  message: string;
  severity: "error" | "warning" | "info";
  code: number;
}

export interface TsCompletion {
  label: string;
  kind: string;
  /** Lower sorts first (TypeScript's sortText). */
  sort: string;
}

/**
 * Diagnostics that are noise for snippets: imports of packages that can't
 * exist in the virtual project ("Cannot find module …" and friends).
 */
const IGNORED_CODES = new Set([2307, 2792, 7016, 2875]);

export function createTsService(ts: typeof TS, libs: Record<string, string>) {
  const files = new Map<string, { text: string; version: number }>();
  const options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    jsx: ts.JsxEmit.Preserve,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowJs: false,
    types: [],
  };
  const libText = (path: string): string | undefined => libs[path.replace(/^.*\//, "")];
  const host: TS.LanguageServiceHost = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (name) => String(files.get(name)?.version ?? 0),
    getScriptSnapshot: (name) => {
      const text = files.get(name)?.text ?? libText(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => options,
    getDefaultLibFileName: () => "/lib.d.ts",
    fileExists: (name) => files.has(name) || libText(name) !== undefined,
    readFile: (name) => files.get(name)?.text ?? libText(name),
    readDirectory: () => [],
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const fileName = (b: { id: string; tsx: boolean }) => `/${b.id}.${b.tsx ? "tsx" : "ts"}`;

  /** Replace the project's files with these blocks. */
  function update(blocks: readonly BlockInput[]): void {
    const wanted = new Set(blocks.map(fileName));
    for (const name of [...files.keys()]) if (!wanted.has(name)) files.delete(name);
    for (const b of blocks) {
      const name = fileName(b);
      const cur = files.get(name);
      if (!cur) files.set(name, { text: b.code, version: 1 });
      else if (cur.text !== b.code) files.set(name, { text: b.code, version: cur.version + 1 });
    }
  }

  function diagnostics(blocks: readonly BlockInput[]): TsDiagnostic[] {
    update(blocks);
    const out: TsDiagnostic[] = [];
    for (const b of blocks) {
      const name = fileName(b);
      const all = [...service.getSyntacticDiagnostics(name), ...service.getSemanticDiagnostics(name)];
      for (const d of all) {
        if (IGNORED_CODES.has(d.code) || d.start === undefined) continue;
        out.push({
          id: b.id,
          start: d.start,
          length: d.length ?? 1,
          message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
          severity:
            d.category === ts.DiagnosticCategory.Error
              ? "error"
              : d.category === ts.DiagnosticCategory.Warning
                ? "warning"
                : "info",
          code: d.code,
        });
      }
    }
    return out;
  }

  function completions(blocks: readonly BlockInput[], id: string, pos: number, limit = 200): TsCompletion[] {
    update(blocks);
    const b = blocks.find((x) => x.id === id);
    if (!b) return [];
    const info = service.getCompletionsAtPosition(fileName(b), pos, {
      includeCompletionsWithInsertText: true,
    });
    if (!info) return [];
    return info.entries
      .slice()
      .sort((x, y) => (x.sortText < y.sortText ? -1 : x.sortText > y.sortText ? 1 : x.name.localeCompare(y.name)))
      .slice(0, limit)
      .map((e) => ({ label: e.name, kind: e.kind, sort: e.sortText }));
  }

  return { diagnostics, completions };
}

export type TsService = ReturnType<typeof createTsService>;
