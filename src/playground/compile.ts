/**
 * Web Playground — the block's half of a run: compile the project here, in
 * the app, and send the runner page JavaScript it only has to link and run
 * (plan W10.D1). The runner page then needs no transpiler, no parser and no
 * script URL: its bundle is built from this repository's code alone
 * (scripts/build-runners.mjs), and its CSP allows that bundle's sha256 and
 * blob: — no 'self', no nonce.
 *
 * Compiling the user's code here runs none of it: Sucrase and acorn read
 * text and write text. The code itself still runs only inside the sandboxed
 * frame.
 */
import { guardLoops, importSpecifiers } from "./files";
import type { CompiledFile, PlaygroundBuild, PlaygroundProject } from "./runtime";

/** Sucrase's `transform`, as far as the playground uses it. */
export type Transform = (
  code: string,
  options: { transforms: Array<"typescript" | "jsx">; jsxRuntime: "automatic" | "classic"; production: boolean; filePath: string },
) => { code: string };

/** The vendor libraries, under /playground/vendor/ (scripts/copy-playground-vendor.mjs). */
export const VENDOR_FILES = {
  react: "react.production.min.js",
  reactDom: "react-dom.production.min.js",
  vue: "vue.esm-browser.prod.js",
} as const;
export type VendorName = keyof typeof VENDOR_FILES;

const message = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

/** One file as JavaScript: CSS and JSON become modules, scripts go through Sucrase and the loop guard. */
export function compileFile(name: string, source: string, framework: PlaygroundProject["framework"], transform: Transform): CompiledFile {
  try {
    let code: string;
    if (/\.css$/i.test(name)) code = `export default ${JSON.stringify(source)};`;
    else if (/\.json$/i.test(name)) code = `export default ${source};`;
    else {
      const ts = /\.tsx?$/i.test(name);
      const jsx = /\.(jsx|tsx)$/i.test(name) || (framework === "react" && /\.js$/i.test(name));
      code = transform(source, {
        transforms: [...(ts ? (["typescript"] as const) : []), ...(jsx ? (["jsx"] as const) : [])],
        jsxRuntime: framework === "react" ? "automatic" : "classic",
        production: true,
        filePath: name,
      }).code;
      code = guardLoops(code);
    }
    return { name, code, specs: importSpecifiers(code) };
  } catch (err) {
    // Reported only if the run reaches this file, as before (the runner throws it).
    return { name, error: message(err) };
  }
}

/** The vendor libraries a compiled project needs: React for a react project, Vue when a file imports it. */
export function vendorNeeds(project: PlaygroundProject, files: readonly CompiledFile[]): VendorName[] {
  const out: VendorName[] = project.framework === "react" ? ["react", "reactDom"] : [];
  if (files.some((f) => "specs" in f && f.specs.some((s) => s.spec === "vue"))) out.push("vue");
  return out;
}

/** A vendor file's text from the app's own origin. */
async function fetchVendor(file: string): Promise<string> {
  const url = new URL(`${import.meta.env?.BASE_URL ?? "/"}playground/vendor/${file}`, location.href);
  // privacy-ledger: not tracked — the app's own origin (a static file the build copied, scripts/copy-playground-vendor.mjs).
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

/** Everything the runner needs for one run. A vendor file that doesn't load is left out; the runner says so if the project needs it. */
export async function buildForRunner(
  project: PlaygroundProject,
  deps: { transform?: Transform; readVendor?: (file: string) => Promise<string> } = {},
): Promise<PlaygroundBuild> {
  const transform = deps.transform ?? ((await import("sucrase")).transform as Transform);
  const files = project.files.map((f) => compileFile(f.name, f.code, project.framework, transform));
  const read = deps.readVendor ?? fetchVendor;
  const vendor: PlaygroundBuild["vendor"] = {};
  await Promise.all(
    vendorNeeds(project, files).map(async (name) => {
      try {
        vendor[name] = await read(VENDOR_FILES[name]);
      } catch {
        /* why: the runner reports the missing library when the project imports it */
      }
    }),
  );
  return { files, vendor };
}
