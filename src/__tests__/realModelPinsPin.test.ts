/**
 * Plan W10.E33 (g6 prep): `npm run ci:real-model-pins -- pin --write` is the
 * Mac's one command that fills models/ci-models.json. A model's digest comes
 * from the local Ollama's /api/tags after the pull, an image's from
 * `docker buildx imagetools inspect`; nothing is guessed, and the exit is 0
 * only when every pin is a digest afterwards.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { digestFromImagetools, digestFromTags, pinAll, pinProblems } from "../../scripts/lib/realModelPins.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { pin } from "../../scripts/real-model-pins.mjs";

const HEX = (c: string) => c.repeat(64);
const PLACEHOLDER = {
  models: { "qwen3:0.6b": { digest: "sha256:PIN-ON-THE-MAC", when: "pr" }, "qwen3:1.7b": { digest: `sha256:${HEX("b")}`, when: "nightly" } },
  images: { "ollama/ollama": "sha256:PIN-ON-THE-MAC" },
};
const IMAGETOOLS = `Name:      docker.io/ollama/ollama:latest\nMediaType: application/vnd.oci.image.index.v1+json\nDigest:    sha256:${HEX("c")}\n\nManifests:\n  Name: docker.io/ollama/ollama:latest@sha256:${HEX("d")}\n`;
const TAGS = { models: [{ name: "qwen3:0.6b", model: "qwen3:0.6b", digest: HEX("a") }, { name: "qwen3:1.7b", digest: HEX("e") }] };

describe("reading a digest", () => {
  it("imagetools: the index's top Digest line, not a per-platform manifest", () => {
    expect(digestFromImagetools(IMAGETOOLS)).toBe(`sha256:${HEX("c")}`);
    expect(digestFromImagetools("Name: x\nMediaType: y\n")).toBeNull();
  });
  it("/api/tags: hex with or without the prefix; a missing model or a short digest is null", () => {
    expect(digestFromTags(TAGS, "qwen3:0.6b")).toBe(`sha256:${HEX("a")}`);
    expect(digestFromTags({ models: [{ name: "m:latest", digest: `sha256:${HEX("f")}` }] }, "m")).toBe(`sha256:${HEX("f")}`);
    expect(digestFromTags(TAGS, "nope")).toBeNull();
    expect(digestFromTags({ models: [{ name: "x", digest: "abc" }] }, "x")).toBeNull();
  });
});

describe("pinAll", () => {
  it("fills only the placeholders; pulls only those models; a pinned one is kept", async () => {
    const pulled: string[] = [];
    const r = await pinAll(PLACEHOLDER, { pull: async (m: string) => void pulled.push(m), tags: async () => TAGS, inspect: async () => IMAGETOOLS });
    expect(pulled).toEqual(["qwen3:0.6b"]);
    expect(r.pins.models["qwen3:0.6b"].digest).toBe(`sha256:${HEX("a")}`);
    expect(r.pins.models["qwen3:1.7b"].digest).toBe(`sha256:${HEX("b")}`); // kept, not the e… of /api/tags
    expect(r.pins.images["ollama/ollama"]).toBe(`sha256:${HEX("c")}`);
    expect(r.problems).toEqual([]);
    expect(pinProblems(r.pins)).toEqual([]);
    expect(PLACEHOLDER.models["qwen3:0.6b"].digest).toBe("sha256:PIN-ON-THE-MAC"); // the input is not changed
  });
  it("--refresh re-reads every pin", async () => {
    const r = await pinAll(PLACEHOLDER, { pull: async () => undefined, tags: async () => TAGS, inspect: async () => IMAGETOOLS, refresh: true });
    expect(r.pins.models["qwen3:1.7b"].digest).toBe(`sha256:${HEX("e")}`);
  });
  it("a digest it cannot read leaves the placeholder and says so", async () => {
    const r = await pinAll(PLACEHOLDER, { pull: async () => undefined, tags: async () => ({ models: [] }), inspect: async () => "no digest here" });
    expect(r.pins.models["qwen3:0.6b"].digest).toBe("sha256:PIN-ON-THE-MAC");
    expect(r.problems).toEqual(["model qwen3:0.6b: no digest in Ollama's /api/tags after the pull", 'image ollama/ollama: no "Digest:" line from docker buildx imagetools inspect']);
  });
});

describe("the pin command", () => {
  it("exit 0 and writes the file only when every pin is a digest; prints JSON", async () => {
    let written = "";
    const io = { pull: async () => undefined, tags: async () => TAGS, inspect: async () => IMAGETOOLS, write: (t: string) => void (written = t) };
    const ok = await pin(["--write"], PLACEHOLDER, io);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ problems: [], written: true });
    expect(JSON.parse(written).models["qwen3:0.6b"].digest).toBe(`sha256:${HEX("a")}`);

    written = "";
    const bad = await pin(["--write"], PLACEHOLDER, { ...io, tags: async () => ({ models: [] }) });
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.out).problems.length).toBeGreaterThan(0);
  });
  it("without --write nothing is written", async () => {
    let wrote = false;
    await pin([], PLACEHOLDER, { pull: async () => undefined, tags: async () => TAGS, inspect: async () => IMAGETOOLS, write: () => void (wrote = true) });
    expect(wrote).toBe(false);
  });
});
