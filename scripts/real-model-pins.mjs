#!/usr/bin/env node
/**
 * `npm run ci:real-model-pins -- <command>` (plan 7.2, W10.E33): the
 * Buildkite real-model steps read their pins here (models/ci-models.json).
 *
 *   check [--model m]… [--image i]…   exit 1 unless each is pinned to a sha256 digest (all when none named)
 *   digest <model>                    the model's pinned digest
 *   image <name>                      the image as name@sha256:…
 *   cache-dir <model> <root>          where the model's Ollama store is cached (keyed by its digest)
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PINS_PATH, cacheDir, imageRef, modelDigest, pinProblems } from "./lib/realModelPins.mjs";

const ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");

export function run(argv, pins = JSON.parse(readFileSync(join(ROOT, PINS_PATH), "utf8"))) {
  const [cmd, ...rest] = argv;
  const many = (flag) => rest.flatMap((a, i) => (rest[i - 1] === flag ? [a] : []));
  if (cmd === "check") {
    const models = many("--model");
    const images = many("--image");
    const problems = pinProblems(pins, models.length || images.length ? { models, images } : {});
    return problems.length ? { code: 1, out: problems.map((p) => `✗ ${p}`).join("\n") } : { code: 0, out: "✓ every real-model pin is a sha256 digest" };
  }
  if (cmd === "digest") return { code: 0, out: modelDigest(pins, rest[0]) };
  if (cmd === "image") return { code: 0, out: imageRef(pins, rest[0]) };
  if (cmd === "cache-dir") return { code: 0, out: cacheDir(pins, rest[0], rest[1] ?? ".") };
  return { code: 2, out: "usage: real-model-pins.mjs check [--model m]… [--image i]… | digest <model> | image <name> | cache-dir <model> <root>" };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const r = run(process.argv.slice(2));
    (r.code ? console.error : console.log)(r.out);
    process.exit(r.code);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
