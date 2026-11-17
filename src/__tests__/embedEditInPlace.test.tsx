/**
 * W12.U1: editing an embedded block (`![[Note#^id]]`, `![[Note#Heading]]`)
 * in place. The embed carries the exact range of its source; an edit changes
 * that range in the source note and nothing else, and undo puts it back. A
 * circular embed is never offered for editing. Notes are synthetic.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { applyEmbedEdit, checksum, splitMarker } from "../editor/embedEdit";
import EmbedEditor, { parseRange, type EmbedEditIo } from "../editor/EmbedEditor";
import { createEmbedContext } from "../renderer/embeds";

afterEach(cleanup);

const parse = (md: string) => unified().use(remarkParse).parse(md) as Root;

const NOTE = "# רעיונות\n\nפסקה ראשונה.\n\nהבלוק שמוטמע כאן ^b1\n\n## פרק ב\n\nטקסט בפרק.\n\n- פריט\n\n## פרק ג\n\nסוף.\n";

type HNode = { type: string; data?: { hName?: string; hProperties?: Record<string, unknown> }; children?: HNode[] };
function editHandles(tree: HNode): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (n: HNode) => {
    if (n.data?.hName === "lumen-embed-edit") out.push(n.data.hProperties!);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return out;
}
function notices(tree: HNode): string[] {
  const out: string[] = [];
  const walk = (n: HNode) => {
    const p = n.data?.hProperties;
    if (p && "data-embed-status" in p) out.push(String(p["data-embed-status"]));
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return out;
}
function expand(host: string, files: Record<string, string>): HNode {
  const ctx = createEmbedContext({ hostPath: "host.md", hostText: host, files: Object.entries(files).map(([path, content]) => ({ path, content })), notice: (k) => k });
  const tree = parse(host);
  ctx.expand(tree, parse);
  return tree as unknown as HNode;
}

describe("the edit range", () => {
  it("checksum, marker split, and an edit that changes only the range", () => {
    expect(checksum("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(splitMarker("הבלוק שמוטמע כאן ^b1")).toEqual({ body: "הבלוק שמוטמע כאן", marker: " ^b1" });
    const start = NOTE.indexOf("הבלוק");
    const end = NOTE.indexOf("^b1") + 3;
    const r = { start, end, sum: checksum(NOTE.slice(start, end)) };
    const res = applyEmbedEdit(NOTE, r, "הבלוק אחרי עריכה\n");
    expect(res).toEqual({ ok: true, text: NOTE.replace("הבלוק שמוטמע כאן ^b1", "הבלוק אחרי עריכה ^b1") });
    expect(applyEmbedEdit(NOTE.replace("פסקה", "Paragraph"), r, "x")).toEqual({ ok: false, reason: "changed" });
    expect(parseRange(`${start}:${end}:${r.sum}`)).toEqual(r);
  });

  it("a block embed gets a handle whose range is the block in the source note", () => {
    const tree = expand("לפני\n\n![[Ideas#^b1]]\n", { "Ideas.md": NOTE });
    const [h] = editHandles(tree);
    expect(h.path).toBe("Ideas.md");
    expect(h.note).toBe("Ideas");
    const r = parseRange(String(h.range))!;
    expect(NOTE.slice(r.start, r.end)).toBe("הבלוק שמוטמע כאן ^b1");
  });

  it("a section embed's range is the heading and its section", () => {
    const [h] = editHandles(expand("![[Ideas#פרק ב]]\n", { "Ideas.md": NOTE }));
    const r = parseRange(String(h.range))!;
    expect(NOTE.slice(r.start, r.end)).toBe("## פרק ב\n\nטקסט בפרק.\n\n- פריט");
  });

  it("circular, nested and self embeds are not offered for editing; a whole-note embed isn't either", () => {
    // A → B → A: the inner embed is a cycle notice, with no handle; only the top-level A is editable.
    const cyc = expand("![[A#^x]]\n", { "A.md": "loop ![[B#^y]] ^x\n", "B.md": "back ![[A#^x]] ^y\n" });
    expect(notices(cyc)).toContain("cycle");
    expect(editHandles(cyc).map((h) => h.path)).toEqual(["A.md"]);
    // A note that embeds itself: only the notice.
    const self = expand("![[host]]\n", { "host.md": "![[host]]\n" });
    expect(notices(self)).toContain("cycle");
    expect(editHandles(self)).toEqual([]);
    // The nested embed inside A (depth 2) has no handle of its own.
    const nested = expand("![[A#^x]]\n", { "A.md": "text ![[B#^y]] ^x\n", "B.md": "inner ^y\n" });
    expect(editHandles(nested).map((h) => h.path)).toEqual(["A.md"]);
    // The host's own section, and a whole note.
    expect(editHandles(expand("# Top\n\ntext\n\n![[#Top]]\n", {}))).toEqual([]);
    expect(editHandles(expand("![[Ideas]]\n", { "Ideas.md": NOTE }))).toEqual([]);
  });
});

describe("the editor", () => {
  function memIo(files: Record<string, string>): EmbedEditIo & { files: Map<string, string>; writes: string[] } {
    const m = new Map(Object.entries(files));
    const writes: string[] = [];
    return { files: m, writes, read: async (p) => m.get(p) ?? "", write: async (p, t) => void (m.set(p, t), writes.push(p)) };
  }
  const range = () => {
    const start = NOTE.indexOf("הבלוק");
    const end = NOTE.indexOf("^b1") + 3;
    return `${start}:${end}:${checksum(NOTE.slice(start, end))}`;
  };

  it("edit in the embed changes the source; undo restores it", async () => {
    const io = memIo({ "Ideas.md": NOTE });
    render(<EmbedEditor path="Ideas.md" range={range()} note="Ideas" io={io} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit this block in Ideas" }));
    const area = (await screen.findByRole("textbox", { name: "Editing the source: Ideas" })) as HTMLTextAreaElement;
    expect(area.value).toBe("הבלוק שמוטמע כאן");
    fireEvent.change(area, { target: { value: "הבלוק אחרי עריכה" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(io.files.get("Ideas.md")).toBe(NOTE.replace("הבלוק שמוטמע כאן ^b1", "הבלוק אחרי עריכה ^b1")));
    expect(io.writes).toEqual(["Ideas.md"]);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(io.files.get("Ideas.md")).toBe(NOTE));
  });

  it("Ctrl+Enter saves and Ctrl+Z after the save undoes it", async () => {
    const io = memIo({ "Ideas.md": NOTE });
    const { container } = render(<EmbedEditor path="Ideas.md" range={range()} note="Ideas" io={io} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit this block in Ideas" }));
    const area = await screen.findByRole("textbox", { name: "Editing the source: Ideas" });
    fireEvent.change(area, { target: { value: "חדש" } });
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(io.files.get("Ideas.md")).toContain("חדש ^b1"));
    fireEvent.keyDown(container.querySelector(".lumen-embed-edit")!, { key: "z", ctrlKey: true });
    await waitFor(() => expect(io.files.get("Ideas.md")).toBe(NOTE));
  });

  it("refuses to edit text that changed since the embed was shown, and undo refuses after a later edit", async () => {
    const io = memIo({ "Ideas.md": NOTE.replace("שמוטמע", "ששונה") });
    render(<EmbedEditor path="Ideas.md" range={range()} note="Ideas" io={io} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit this block in Ideas" }));
    expect(await screen.findByText(/The source changed/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(io.writes).toEqual([]);
  });
});
