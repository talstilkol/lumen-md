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
  /** JavaScript: syntax errors always, type errors only with `// @ts-check`. */
  js?: boolean;
  /** Concatenated `live-js shared` blocks: re-declaring a name is allowed. */
  shared?: boolean;
}

export interface TsQuickInfo {
  /** Signature / type, e.g. `const n: number`. */
  text: string;
  /** JSDoc text, if any. */
  doc: string;
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

/**
 * Re-declarations, normal across `live-js shared` blocks (re-runs redeclare)
 * — but only of top-level names, which the shared runner turns into
 * assignments; a duplicate in a nested scope still fails at run time.
 */
const SHARED_IGNORED_CODES = new Set([2451, 2300, 2393]);

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
    allowJs: true,
    checkJs: false,
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
  const fileName = (b: { id: string; tsx: boolean; js?: boolean }) =>
    `/${b.id}.${b.js ? (b.tsx ? "jsx" : "js") : b.tsx ? "tsx" : "ts"}`;

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

  /** Start offsets of the names a file's top-level statements declare. */
  function topLevelDeclarationStarts(name: string): Set<number> {
    const starts = new Set<number>();
    const file = service.getProgram()?.getSourceFile(name);
    if (!file) return starts;
    const addBinding = (n: TS.BindingName) => {
      if (ts.isIdentifier(n)) starts.add(n.getStart(file));
      else for (const e of n.elements) if (!ts.isOmittedExpression(e)) addBinding(e.name);
    };
    for (const st of file.statements) {
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) addBinding(d.name);
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) starts.add(st.name.getStart(file));
    }
    return starts;
  }

  function diagnostics(blocks: readonly BlockInput[]): TsDiagnostic[] {
    update(blocks);
    const out: TsDiagnostic[] = [];
    for (const b of blocks) {
      const name = fileName(b);
      const all = [...service.getSyntacticDiagnostics(name), ...service.getSemanticDiagnostics(name)];
      let topLevel: Set<number> | undefined;
      for (const d of all) {
        if (IGNORED_CODES.has(d.code) || d.start === undefined) continue;
        if (b.shared && SHARED_IGNORED_CODES.has(d.code) && (topLevel ??= topLevelDeclarationStarts(name)).has(d.start)) continue;
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

  function quickInfo(blocks: readonly BlockInput[], id: string, pos: number): TsQuickInfo | null {
    update(blocks);
    const b = blocks.find((x) => x.id === id);
    if (!b) return null;
    const info = service.getQuickInfoAtPosition(fileName(b), pos);
    if (!info) return null;
    const text = ts.displayPartsToString(info.displayParts);
    if (!text) return null;
    return { text, doc: ts.displayPartsToString(info.documentation) };
  }

  return { diagnostics, completions, quickInfo };
}

export type TsService = ReturnType<typeof createTsService>;
