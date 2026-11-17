"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
var main_exports = {};
__export(main_exports, { default: () => StampPlugin });
module.exports = main_exports;
var import_obsidian = require("obsidian");
class StampPlugin extends import_obsidian.Plugin {
  onload() {
    this.app.workspace.onLayoutReady(() => { this.ready = true; });
    this.addCommand({ id: "stamp", name: "Stamp the open note as reviewed", callback: async () => {
      const file = this.app.workspace.getActiveFile();
      if (!(file instanceof import_obsidian.TFile)) throw new Error("no file");
      await this.app.fileManager.processFrontMatter(file, (fm) => { fm.reviewed = "2026-11-17"; });
    } });
    this.addCommand({ id: "tag-report", name: "Tag report", callback: async () => {
      const counts = {};
      for (const f of this.app.vault.getMarkdownFiles()) {
        const cache = this.app.metadataCache.getFileCache(f);
        for (const t of (0, import_obsidian.getAllTags)(cache) ?? []) counts[t] = (counts[t] ?? 0) + 1;
      }
      const lines = Object.keys(counts).sort().map((t) => `- ${t}: ${counts[t]}`);
      await this.app.vault.create("Tag report.md", "# Tags\n" + lines.join("\n") + "\n");
    } });
    this.registerMarkdownCodeBlockProcessor("stamp", (src, el) => { el.createEl("b", { text: src.trim() }); });
  }
}
