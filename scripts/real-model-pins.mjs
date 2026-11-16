#!/usr/bin/env node
/**
 * `npm run ci:real-model-pins -- <command>` (plan 7.2, W10.E33): the
 * Buildkite real-model steps read their pins here (models/ci-models.json).
 *
 *   check [--model m]… [--image i]…   exit 1 unless each is pinned to a sha256 digest (all when none named)
 *   digest <model>                    the model's pinned digest
 *   image <name>                      the image as name@sha256:…
 *   cache-dir <model> <root>          where the model's Ollama store is cached (keyed by its digest)
 *   pin [--write] [--refresh]         on the Mac: `ollama pull` each model and read its digest from
 *                                     the local Ollama (/api/tags, OLLAMA_HOST or 127.0.0.1:11434),
 *                                     `docker buildx imagetools inspect` each image; prints JSON
 *                                     {pinned, problems}; --write saves models/ci-models.json.
 *                                     Exit 0 only when every pin is a digest afterwards.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PINS_PATH, cacheDir, imageRef, modelDigest, pinAll, pinProblems } from "./lib/realModelPins.mjs";

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
  return { code: 2, out: "usage: real-model-pins.mjs check [--model m]… [--image i]… | digest <model> | image <name> | cache-dir <model> <root> | pin [--write] [--refresh]" };
}

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status ?? r.error?.message}`);
  return r.stdout;
};

/** `pin` (W10.E33): fill the placeholders from the Mac's Ollama and Docker. Seams: pull, tags, inspect, write. */
export async function pin(argv, pins = JSON.parse(readFileSync(join(ROOT, PINS_PATH), "utf8")), io = {}) {
  const host = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/^(?!https?:)/, "http://");
  const {
    pull = (m) => sh("ollama", ["pull", m]),
    tags = async () => (await fetch(`${host}/api/tags`)).json(),
    inspect = (i) => sh("docker", ["buildx", "imagetools", "inspect", i]),
    write = (text) => writeFileSync(join(ROOT, PINS_PATH), text),
  } = io;
  const r = await pinAll(pins, { pull, tags, inspect, refresh: argv.includes("--refresh") });
  const left = pinProblems(r.pins);
  if (argv.includes("--write") && r.lines.length) write(`${JSON.stringify(r.pins, null, 2)}\n`);
  return { code: left.length ? 1 : 0, out: JSON.stringify({ pinned: r.lines, problems: [...r.problems, ...left], written: argv.includes("--write") && r.lines.length > 0 }, null, 2) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const argv = process.argv.slice(2);
    const r = argv[0] === "pin" ? await pin(argv.slice(1)) : run(argv);
    (r.code ? console.error : console.log)(r.out);
    process.exit(r.code);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
