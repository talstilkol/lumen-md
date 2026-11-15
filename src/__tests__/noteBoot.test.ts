/**
 * Plan W2.21: the boot shell shows the last note before the bundle loads
 * (public/boot.js, W10.E19), as an editable textarea (W10.E20), and preloads
 * the start's lazy chunks in parallel (W10.E20).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { applyBootEdit, BOOT_EDIT_KEY, takeBootEdit, type BootNote } from "../boot/bootNote";
import { useAppStore } from "../store/useStore";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const script = readFileSync(join(root, "public/boot.js"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");
const boot = () => new Function(script)();
const SHELL = '<div class="boot-shell" aria-hidden="true"><div class="boot-bar"></div><div class="boot-page"><div class="boot-line"></div></div></div>';
const saved = (state: unknown) => localStorage.setItem("lumen-md", JSON.stringify({ state, version: 0 }));
const page = () => document.querySelector(".boot-page")!;

describe("note boot script", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = SHELL;
    document.documentElement.removeAttribute("data-boot-note");
    document.documentElement.removeAttribute("data-boot-edited");
    delete (window as { __lumenBootNote?: unknown }).__lumenBootNote;
  });

  it("is the one boot script, in <head> before the boot shell and the app module", () => {
    const at = html.indexOf('<script src="/boot.js"></script>');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf("</head>"));
    expect(at).toBeLessThan(html.indexOf('class="boot-shell"'));
    expect(at).toBeLessThan(html.indexOf('<script type="module"'));
    // W10.E19: one file, not three.
    expect(html).not.toMatch(/(theme|locale|note)-boot\.js/);
    expect((html.match(/<script src="\/[^"]+\.js"><\/script>/g) ?? []).length).toBe(1);
    // Skeleton bars the parser adds after the note was painted stay hidden.
    expect(html).toContain("[data-boot-note] .boot-line{display:none}");
  });

  it("run in <head>, it fills the shell as soon as the parser inserts it", async () => {
    saved({ doc: { content: "פתק אחרון" } });
    document.body.innerHTML = "";
    boot();
    expect(document.documentElement.hasAttribute("data-boot-note")).toBe(false);
    document.body.innerHTML = SHELL;
    await new Promise((r) => setTimeout(r, 0));
    expect(page().querySelector<HTMLTextAreaElement>("textarea.boot-note")!.value).toBe("פתק אחרון");
    expect(document.documentElement.hasAttribute("data-boot-note")).toBe(true);
  });

  it("shows the persisted note as text, never as HTML", () => {
    saved({ doc: { content: "# שלום\n\n<img src=x onerror=alert(1)> text" } });
    boot();
    const note = page().querySelector<HTMLTextAreaElement>("textarea.boot-note")!;
    expect(note.value).toContain("# שלום");
    expect(page().querySelector("img")).toBeNull();
    expect(page().querySelector(".boot-line")).toBeNull();
    expect(note.getAttribute("dir")).toBe("auto");
    expect(document.documentElement.hasAttribute("data-boot-note")).toBe(true);
  });

  it("shows only the beginning of a long note", () => {
    saved({ doc: { content: "x".repeat(10_000) }, rtl: true });
    boot();
    expect(page().querySelector("textarea")!.value.length).toBe(4000);
    expect(page().querySelector("textarea")!.getAttribute("dir")).toBe("rtl");
  });

  it("keeps the skeleton with nothing saved, an empty note or corrupt storage", () => {
    boot();
    expect(page().querySelector(".boot-line")).not.toBeNull();
    saved({ doc: { content: "   " } });
    boot();
    expect(page().querySelector(".boot-line")).not.toBeNull();
    localStorage.setItem("lumen-md", "{oops");
    boot();
    expect(page().querySelector(".boot-line")).not.toBeNull();
  });
});

const bootNote = () => (window as unknown as { __lumenBootNote: BootNote }).__lumenBootNote;
/** Type into the boot textarea as a keyboard would: the value changes, then an input event. */
function type(el: HTMLTextAreaElement, text: string, at = el.value.length): void {
  el.focus();
  el.setSelectionRange(at, at);
  el.value = el.value.slice(0, at) + text + el.value.slice(at);
  el.setSelectionRange(at + text.length, at + text.length);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("W10.E20: the boot note is editable, and what is typed reaches the editor", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = SHELL;
    document.documentElement.removeAttribute("data-boot-note");
    document.documentElement.removeAttribute("data-boot-edited");
    delete (window as { __lumenBootNote?: unknown }).__lumenBootNote;
  });

  it("a plain textarea, reachable (the shell is no longer aria-hidden), named after the note", () => {
    saved({ doc: { name: "יומן.md", content: "שורה ראשונה" } });
    boot();
    const el = page().querySelector<HTMLTextAreaElement>("textarea.boot-note")!;
    expect(el.readOnly).toBe(false);
    expect(el.getAttribute("aria-label")).toBe("יומן.md");
    expect(document.querySelector(".boot-shell")!.hasAttribute("aria-hidden")).toBe(false);
    type(el, " ועוד");
    expect(document.documentElement.hasAttribute("data-boot-edited")).toBe(true);
  });

  it("typing before the bundle loads is kept: the hand-off puts it in the open note", () => {
    saved({ doc: { name: "Last.md", content: "# Last note\n\nThe text" } });
    boot();
    useAppStore.setState({ doc: { ...useAppStore.getState().doc, name: "Last.md", content: "# Last note\n\nThe text" } });
    const el = page().querySelector<HTMLTextAreaElement>("textarea.boot-note")!;
    type(el, " I typed before the app loaded");
    type(el, "כותרת: ", 2);
    const edit = takeBootEdit()!;
    expect(el.readOnly).toBe(true);
    expect(edit.content).toBe("# כותרת: Last note\n\nThe text I typed before the app loaded");
    expect(edit.selection).toEqual([9, 9]);
    expect(applyBootEdit(edit, useAppStore)).toBe(true);
    expect(useAppStore.getState().doc.content).toBe(edit.content);
    expect(useAppStore.getState().doc.dirty).toBe(true);
  });

  it("a 10,000-character note: the textarea holds the first 4,000, and an edit keeps the other 6,000 after them", () => {
    const long = "א".repeat(5000) + "ב".repeat(5000);
    saved({ doc: { name: "long.md", content: long } });
    boot();
    useAppStore.setState({ doc: { ...useAppStore.getState().doc, name: "long.md", content: long } });
    const el = page().querySelector<HTMLTextAreaElement>("textarea.boot-note")!;
    expect(el.value.length).toBe(4000);
    expect(bootNote().tail.length).toBe(6000);
    type(el, "!", 0);
    const edit = takeBootEdit()!;
    expect(edit.content).toBe("!" + long);
    applyBootEdit(edit, useAppStore);
    expect(useAppStore.getState().doc.content.length).toBe(10_001);
  });

  it("nothing typed: no edit, and the note is untouched", () => {
    saved({ doc: { name: "a.md", content: "text" } });
    boot();
    expect(takeBootEdit()).toBeNull();
    expect(takeBootEdit({})).toBeNull();
  });

  it("the open note is another one by the hand-off: the edit is kept aside, not written over it", () => {
    saved({ doc: { name: "a.md", content: "text" } });
    boot();
    useAppStore.setState({ doc: { ...useAppStore.getState().doc, name: "b.md", content: "other note" } });
    type(page().querySelector<HTMLTextAreaElement>("textarea.boot-note")!, " typed");
    const edit = takeBootEdit()!;
    expect(applyBootEdit(edit, useAppStore)).toBe(false);
    expect(useAppStore.getState().doc.content).toBe("other note");
    expect(JSON.parse(localStorage.getItem(BOOT_EDIT_KEY)!)).toMatchObject({ name: "a.md", content: "text typed" });
  });

  it("main.tsx hands the edit over before React replaces the shell", () => {
    const main = readFileSync(join(root, "src/main.tsx"), "utf8");
    const render = main.slice(main.indexOf("function renderApp()"));
    expect(render).toMatch(/^function renderApp\(\) \{\n(?:\/\/.*\n)*const bootEdit = [^\n]*takeBootEdit\(\);\nif \(bootEdit\) applyBootEdit\(bootEdit, useAppStore\);\nReactDOM\.createRoot/);
  });
});

describe("W10.E20: the start's lazy chunks are preloaded in parallel", () => {
  const LIST = {
    always: ["/assets/location-a1.js", "/assets/vaultDocs-b2.js"],
    editors: { source: ["/assets/Editor-c3.js", "/assets/vendor-codemirror-d4.js"], wysiwyg: ["/assets/WysiwygEditor-e5.js"] },
    locales: { he: ["/assets/locale-he-ai-f6.js", "/assets/locale-he-ui-g7.js"], ru: ["/assets/locale-ru-ui-h8.js"] },
  };
  const withList = (list: unknown) => {
    document.head.querySelectorAll('link[rel="modulepreload"], #lumen-boot-preload').forEach((n) => n.remove());
    const tag = document.createElement("script");
    tag.type = "application/json";
    tag.id = "lumen-boot-preload";
    tag.textContent = typeof list === "string" ? list : JSON.stringify(list);
    document.head.appendChild(tag);
  };
  const preloaded = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].map((l) => l.getAttribute("href"));

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = SHELL;
  });

  it("the vault's chunks, the saved language's strings and the saved view's editor", () => {
    withList(LIST);
    saved({ locale: "he", mode: "source", doc: { content: "x" } });
    boot();
    expect(preloaded()).toEqual([...LIST.always, ...LIST.locales.he, ...LIST.editors.source]);
    expect(document.head.querySelector('link[rel="modulepreload"]')!.hasAttribute("crossorigin")).toBe(true);
  });

  it("WYSIWYG gets its editor; Preview none; English no strings", () => {
    withList(LIST);
    saved({ locale: "en", mode: "wysiwyg" });
    boot();
    expect(preloaded()).toEqual([...LIST.always, ...LIST.editors.wysiwyg]);
    withList(LIST);
    saved({ locale: "ru", mode: "preview" });
    boot();
    expect(preloaded()).toEqual([...LIST.always, ...LIST.locales.ru]);
  });

  it("no list (the dev server), a corrupt one, or a path that is not a same-origin script: nothing is added", () => {
    document.head.querySelectorAll('link[rel="modulepreload"], #lumen-boot-preload').forEach((n) => n.remove());
    boot();
    expect(preloaded()).toEqual([]);
    withList("{oops");
    boot();
    expect(preloaded()).toEqual([]);
    withList({ always: ["https://evil.example/x.js", "//evil.example/y.js", "/assets/ok.js", "/assets/ok.js"] });
    boot();
    expect(preloaded()).toEqual(["/assets/ok.js"]);
  });
});
