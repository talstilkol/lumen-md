/**
 * W10.E67 (plan 4.15): the clip templates and triggers editor, and the user
 * templates it saves winning over the built-in site ones when a clip is built.
 * The vault file is an in-memory TemplateIo; the store, the trigger logic and
 * buildClip's template choice are the real code. The Obsidian Web Clipper
 * export below is a SYNTHETIC example in that format's field names.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { ClipTemplatesEditor } from "../research/ClipTemplatesEditor";
import { CLIP_TEMPLATES_PATH, importObsidianTemplate, loadUserTemplates, parseTemplates, saveUserTemplates, serializeTemplates, templateProblems, whichTemplate, type TemplateIo } from "../research/clipTemplateStore";
import { DEFAULT_TEMPLATE, SITE_TEMPLATES, pickTemplate, type ClipTemplate } from "../research/clipTemplates";

const memoryIo = (files = new Map<string, string>()): TemplateIo & { files: Map<string, string> } => ({ files, read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) });
const mine: ClipTemplate = { id: "blog", name: "My blog", path: "Blog", noteName: "{{title}}", properties: [{ name: "source", value: "{{url}}" }], content: "{{content}}", triggers: ["https://blog.example.org/", "/wikipedia\\.org\\/wiki\\/Special/"] };

describe("clip template store (W10.E67)", () => {
  it("validates names, ids, triggers and property names", () => {
    expect(templateProblems(mine, [mine])).toEqual([]);
    const bad: ClipTemplate = { ...mine, name: " ", triggers: ["blog.example.org", "/([/", "schema:Recipe x"], properties: [{ name: "a b", value: "" }] };
    expect(templateProblems(bad, [bad, { ...mine }]).map((p) => p.key)).toEqual(["clipTemplates.problem.name", "clipTemplates.problem.duplicate", "clipTemplates.problem.trigger", "clipTemplates.problem.regex", "clipTemplates.problem.trigger", "clipTemplates.problem.property"]);
  });

  it("saves to .lumen/clip-templates.json and loads back; a broken file gives no templates instead of throwing; an invalid list is refused", async () => {
    const io = memoryIo();
    await saveUserTemplates([mine], io);
    expect(JSON.parse(io.files.get(CLIP_TEMPLATES_PATH)!)).toMatchObject({ version: 1, templates: [{ id: "blog" }] });
    expect(await loadUserTemplates(io)).toEqual([mine]);
    expect(await loadUserTemplates(memoryIo(new Map([[CLIP_TEMPLATES_PATH, "{not json"]])))).toEqual([]);
    expect(parseTemplates(JSON.stringify([{ name: "" }, 3, { name: "ok" }])).map((x) => x.name)).toEqual(["ok"]);
    await expect(saveUserTemplates([{ ...mine, triggers: ["nope"] }], io)).rejects.toThrow(/not saved/);
    expect(await loadUserTemplates(null)).toEqual([]);
  });

  it("the user's templates win over the built-in site templates, through the same pickTemplate buildClip uses", () => {
    const wiki = "https://en.wikipedia.org/wiki/Special:Random";
    expect(pickTemplate(wiki, null, []).id).toBe(SITE_TEMPLATES.find((x) => x.triggers?.some((tr) => wiki.startsWith(tr) || (tr.startsWith("/") && new RegExp(tr.slice(1, -1)).test(wiki))))!.id);
    expect(pickTemplate(wiki, null, [mine]).id).toBe("blog");
    expect(whichTemplate("https://blog.example.org/post/1", [mine, ...SITE_TEMPLATES])).toEqual({ template: mine, trigger: "https://blog.example.org/" });
    expect(whichTemplate("https://nowhere.example/", [mine])).toBeNull();
  });

  it("imports an Obsidian Web Clipper template export", () => {
    const exported = { schemaVersion: "0.1.0", name: "Recipes", behavior: "create", noteNameFormat: "{{title}}", path: "Cooking", properties: [{ name: "source", value: "{{url}}", type: "text" }], triggers: ["schema:@Recipe"], noteContentFormat: "{{content}}" };
    const [t] = importObsidianTemplate(JSON.stringify(exported));
    expect(t).toEqual({ id: "recipes", name: "Recipes", path: "Cooking", noteName: "{{title}}", properties: [{ name: "source", value: "{{url}}" }], content: "{{content}}", triggers: ["schema:@Recipe"] });
    expect(() => importObsidianTemplate(JSON.stringify({ title: "x" }))).toThrow(/Obsidian Web Clipper/);
    expect(parseTemplates(serializeTemplates([t]))).toEqual([t]);
  });
});

describe("the editor (W10.E67)", () => {
  it("new template → triggers → a bad trigger blocks saving → fixed → saved; test an address; a built-in is read-only until duplicated", async () => {
    const io = memoryIo();
    const { getByTestId, queryByTestId } = render(<ClipTemplatesEditor initial={[]} io={io} onClose={() => undefined} />);
    // A built-in first: read-only, with Duplicate.
    expect((getByTestId("clip-template-name") as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(getByTestId("clip-templates-new"));
    await waitFor(() => expect((getByTestId("clip-template-name") as HTMLInputElement).readOnly).toBe(false));
    fireEvent.change(getByTestId("clip-template-name"), { target: { value: "Docs" } });
    fireEvent.change(getByTestId("clip-template-triggers"), { target: { value: "docs.example.org" } });
    await waitFor(() => expect(getByTestId("clip-template-problems").textContent).toContain("docs.example.org"));
    expect((getByTestId("clip-templates-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(getByTestId("clip-template-triggers"), { target: { value: "https://docs.example.org/" } });
    await waitFor(() => expect(queryByTestId("clip-template-problems")).toBeNull());
    fireEvent.change(getByTestId("clip-templates-test"), { target: { value: "https://docs.example.org/guide" } });
    await waitFor(() => expect(getByTestId("clip-templates-test-result").textContent).toContain("Docs"));
    fireEvent.click(getByTestId("clip-templates-save"));
    await waitFor(() => expect(io.files.has(CLIP_TEMPLATES_PATH)).toBe(true));
    const saved = await loadUserTemplates(io);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: "Docs", triggers: ["https://docs.example.org/"], content: DEFAULT_TEMPLATE.content });
    expect(pickTemplate("https://docs.example.org/guide", null, saved).name).toBe("Docs");
  });
});
