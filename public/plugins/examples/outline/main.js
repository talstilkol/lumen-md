// Outline — an example Lumen plugin (plan 11.2): reads the open note,
// shows its headings in a panel, inserts a table of contents. Sandboxed:
// document:read, document:write, commands, panel.

function headings(text) {
  const out = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2] });
  }
  return out;
}

async function showOutline() {
  const hs = headings(await lumen.document.getText());
  await lumen.panel.open({ title: "Outline" });
  await lumen.panel.render({
    type: "box",
    children: [
      hs.length
        ? { type: "list", items: hs.map((h) => [{ type: "text", text: `${"  ".repeat(h.level - 1)}${h.text}` }]) }
        : { type: "text", text: "No headings in this note." },
      { type: "divider" },
      { type: "button", id: "toc", label: "Insert table of contents", primary: true, disabled: hs.length === 0 },
    ],
  });
}

async function insertToc() {
  const hs = headings(await lumen.document.getText());
  if (!hs.length) return;
  const min = Math.min(...hs.map((h) => h.level));
  const toc = hs.map((h) => `${"  ".repeat(h.level - min)}- [[#${h.text}]]`).join("\n");
  await lumen.document.insertText(toc + "\n");
}

lumen.on("ui:panel", async (e) => {
  if (e.id === "toc" && e.kind === "click") await insertToc();
});

await lumen.commands.register({ id: "outline", label: "Outline", hint: "Headings of this note" }, showOutline);
await lumen.commands.register({ id: "toc", label: "Insert table of contents" }, insertToc);
