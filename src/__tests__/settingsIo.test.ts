/**
 * Plan 11.1 — settings export / import: only settings leave the device,
 * and an import takes only values that fit the schema.
 */
import { describe, it, expect } from "vitest";
import { exportSettings, importSettings, parseSettingsFile, type SettingsTarget } from "../settings/io";

function makeTarget(initialLocal: Record<string, string>, initialApp: Record<string, unknown>) {
  const mem = new Map(Object.entries(initialLocal));
  let app = { ...initialApp };
  const target: SettingsTarget = {
    getApp: () => app,
    applyApp: (patch) => {
      app = { ...app, ...patch };
    },
    storage: {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, String(v)),
      removeItem: (k) => void mem.delete(k),
      key: (i) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size;
      },
    },
  };
  return { target, mem, app: () => app };
}

describe("settings export", () => {
  it("writes settings and leaves out secrets, content, caches and trust anchors", () => {
    const { target } = makeTarget(
      {
        "lumen.ai.policy": "local-only",
        "lumen.ollama.model": "qwen2.5:7b",
        "lumen.ai.model.gemini": "gemini-2.0-flash",
        "lumen.ai.key.openai": "sk-secret",
        "lumen.collab.wsToken": "token",
        "lumen.ai.cache": "{}",
        "lumen.plugins.trusted-keys": "[]",
        "other-app": "x",
      },
      { mode: "split", vimEnabled: true, doc: { name: "a.md", content: "private" }, openTabs: [], aiKey: "k" },
    );
    const file = exportSettings(target);
    expect(file.format).toBe("lumen-settings");
    expect(file.app).toEqual({ mode: "split", vimEnabled: true });
    expect(file.local).toEqual({
      "lumen.ai.model.gemini": "gemini-2.0-flash",
      "lumen.ai.policy": "local-only",
      "lumen.ollama.model": "qwen2.5:7b",
    });
    expect(JSON.stringify(file)).not.toContain("secret");
    expect(JSON.stringify(file)).not.toContain("private");
  });

  it("round-trips through a file", () => {
    const src = makeTarget({ "lumen.ollama.baseUrl": "http://127.0.0.1:11434" }, { theme: "light", splitAxis: "vertical" });
    const text = JSON.stringify(exportSettings(src.target));
    const dst = makeTarget({}, { theme: "dark", splitAxis: "auto" });
    const parsed = parseSettingsFile(text);
    expect(parsed).not.toBeNull();
    expect(importSettings(parsed!, dst.target)).toEqual({ applied: 3, skipped: [] });
    expect(dst.app()).toMatchObject({ theme: "light", splitAxis: "vertical" });
    expect(dst.mem.get("lumen.ollama.baseUrl")).toBe("http://127.0.0.1:11434");
  });
});

describe("settings import", () => {
  it("rejects text that isn't a settings file", () => {
    expect(parseSettingsFile("not json")).toBeNull();
    expect(parseSettingsFile("{}")).toBeNull();
    expect(parseSettingsFile(JSON.stringify({ format: "lumen-settings", version: 2 }))).toBeNull();
  });

  it("skips unknown keys, secrets, data and values of the wrong type", () => {
    const { target, mem, app } = makeTarget({ "lumen.ai.key.openai": "mine" }, { mode: "split", vimEnabled: false });
    const file = parseSettingsFile(
      JSON.stringify({
        format: "lumen-settings",
        version: 1,
        app: { vimEnabled: true, mode: "nope", doc: { content: "x" }, writingGoalWords: -5, syncScroll: "single" },
        local: {
          "lumen.ai.key.openai": "stolen",
          "lumen.plugins.trusted-keys": "[\"evil\"]",
          "lumen.collab.publicSignaling": "yes",
          "lumen.git.watch": "1",
          "unknown.key": "1",
        },
      }),
    )!;
    const result = importSettings(file, target);
    expect(result.applied).toBe(3);
    expect(result.skipped.sort()).toEqual(
      ["doc", "lumen.ai.key.openai", "lumen.collab.publicSignaling", "lumen.plugins.trusted-keys", "mode", "unknown.key", "writingGoalWords"].sort(),
    );
    expect(app()).toMatchObject({ vimEnabled: true, mode: "split", syncScroll: "single" });
    expect(mem.get("lumen.ai.key.openai")).toBe("mine");
    expect(mem.has("lumen.plugins.trusted-keys")).toBe(false);
    expect(mem.get("lumen.git.watch")).toBe("1");
  });

  it("never loosens the AI policy, but may tighten it", () => {
    const loose = makeTarget({ "lumen.ai.policy": "local-only" }, {});
    const toCloud = parseSettingsFile(JSON.stringify({ format: "lumen-settings", version: 1, app: {}, local: { "lumen.ai.policy": "cloud" } }))!;
    expect(importSettings(toCloud, loose.target).skipped).toEqual(["lumen.ai.policy"]);
    expect(loose.mem.get("lumen.ai.policy")).toBe("local-only");

    const strict = makeTarget({ "lumen.ai.policy": "cloud" }, {});
    const toLocal = parseSettingsFile(JSON.stringify({ format: "lumen-settings", version: 1, app: {}, local: { "lumen.ai.policy": "local-only" } }))!;
    expect(importSettings(toLocal, strict.target)).toEqual({ applied: 1, skipped: [] });
    expect(strict.mem.get("lumen.ai.policy")).toBe("local-only");
  });

  it("removes a key when the file turns a text-stored switch off", () => {
    const { target, mem } = makeTarget({ "lumen.git.watch": "1" }, {});
    const file = parseSettingsFile(JSON.stringify({ format: "lumen-settings", version: 1, app: {}, local: { "lumen.git.watch": "" } }))!;
    expect(importSettings(file, target).applied).toBe(1);
    expect(mem.has("lumen.git.watch")).toBe(false);
  });
});
