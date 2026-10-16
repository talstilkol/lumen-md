/**
 * Web Worker hosting the TypeScript language service for ```ts blocks.
 * Heavy (the compiler + ES/DOM lib files, several MB): created only when
 * the user turns "TypeScript checks" on, and never precached by the PWA.
 */
import * as ts from "typescript";
import { createTsService, type BlockInput } from "./tsService";

const libModules = import.meta.glob(
  [
    "../../node_modules/typescript/lib/lib.es5.d.ts",
    "../../node_modules/typescript/lib/lib.es20*.d.ts",
    "../../node_modules/typescript/lib/lib.decorators*.d.ts",
    "../../node_modules/typescript/lib/lib.dom*.d.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const libs: Record<string, string> = {};
for (const [path, text] of Object.entries(libModules)) libs[path.replace(/^.*\//, "")] = text;

const service = createTsService(ts, libs);

export type TsWorkerRequest =
  | { id: number; type: "check"; blocks: BlockInput[] }
  | { id: number; type: "complete"; blocks: BlockInput[]; block: string; pos: number };

self.onmessage = (e: MessageEvent<TsWorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "check") {
      self.postMessage({ id: msg.id, ok: true, result: service.diagnostics(msg.blocks) });
    } else {
      self.postMessage({ id: msg.id, ok: true, result: service.completions(msg.blocks, msg.block, msg.pos) });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
