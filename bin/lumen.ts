#!/usr/bin/env node
/**
 * `lumen` CLI — headless document conversion.
 *
 *   lumen convert <input> [output]   convert a file (format from extensions)
 *   lumen formats                    list supported import/export formats
 *
 * Run with:  npx tsx bin/lumen.ts convert notes.md notes.tex
 */
import { readFileSync, writeFileSync } from "node:fs";
import { convert, listFormats } from "../src/cli/convert";

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;

  if (cmd === "formats") {
    const f = listFormats();
    console.log("export (md → X):", f.export.join(", "));
    console.log("import (X → md):", f.import.join(", "));
    return 0;
  }

  if (cmd !== "convert" || rest.length < 1) {
    console.error("usage: lumen convert <input> [output]\n       lumen formats");
    return 1;
  }

  const inFile = rest[0];
  const inText = readFileSync(inFile, "utf8");
  const toExt = rest[1] ? rest[1].split(".").pop() : undefined;
  const { outName, outText } = convert(inFile, inText, toExt);
  const outFile = rest[1] || outName;
  writeFileSync(outFile, outText);
  console.log(`✓ ${inFile} → ${outFile} (${outText.length} bytes)`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (err) {
  console.error("error:", (err as Error).message);
  process.exit(1);
}
