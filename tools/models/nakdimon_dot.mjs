#!/usr/bin/env node
/**
 * Nakdimon (MIT) niqqud for the eval:public cmd engine (LUMEN_NIKUD_CMD,
 * W11.M3): undotted text on stdin, dotted text on stdout — through the
 * app's own code (src/text/nikudRun.ts addNikud, the in-browser path) with
 * onnxruntime-node instead of the worker, as scripts/golden/evals/nikud.mjs
 * runs it. The model file is given by path (NAKDIMON_ONNX or --model).
 *
 *   LUMEN_NIKUD_CMD='node tools/models/nakdimon_dot.mjs --model models/nakdimon/Nakdimon.onnx'
 */
import { createRequire } from "node:module";

/** onnxruntime-node session → the NikudEngine run addNikud takes (int32 ids [rows, length] → N, D, S). */
export function nakdimonRun(session, Tensor) {
  return async (ids, rows, length) => {
    const out = await session.run({ [session.inputNames[0]]: new Tensor("int32", ids, [rows, length]) });
    return { N: out.N.data, D: out.D.data, S: out.S.data };
  };
}

async function readStdin() {
  let s = "";
  for await (const c of process.stdin) s += c;
  return s;
}

if (process.argv[1]?.endsWith("nakdimon_dot.mjs")) {
  const args = process.argv.slice(2);
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : process.env.NAKDIMON_ONNX;
  if (!model) (console.error("--model <Nakdimon.onnx> (or NAKDIMON_ONNX) is required"), process.exit(2));
  const ort = createRequire(import.meta.url)("onnxruntime-node");
  const session = await ort.InferenceSession.create(model);
  const { tsImport } = await import("tsx/esm/api");
  const { addNikud } = await tsImport("../../src/text/nikudRun.ts", import.meta.url);
  process.stdout.write(await addNikud((await readStdin()).replace(/\r?\n$/, ""), nakdimonRun(session, ort.Tensor)));
}
