"use strict";
// Fixture for the Obsidian compatibility spike (MIT): the shape of a typical esbuild bundle.
var obsidian = require("obsidian");
const DEFAULTS = { prefix: "> ", count: 0 };
class QuoteSettings extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Quote" });
    new obsidian.Setting(containerEl).setName("Prefix").setDesc("Put before each line").addText((t) => t.setValue(this.plugin.settings.prefix).onChange(async (v) => { this.plugin.settings.prefix = v; await this.plugin.saveSettings(); }));
    new obsidian.Setting(containerEl).setName("Count").addToggle((t) => t.setValue(true));
  }
}
class QuotePlugin extends obsidian.Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new QuoteSettings(this.app, this));
    this.addCommand({ id: "quote-selection", name: "Quote selection", editorCallback: (editor) => {
      const sel = editor.getSelection();
      editor.replaceSelection(sel.split("\n").map((l) => this.settings.prefix + l).join("\n"));
    } });
    this.addCommand({ id: "count-words", name: "Count words", checkCallback: (checking) => {
      const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (!view) return false;
      if (!checking) {
        const n = view.editor.getValue().split(/\s+/).filter(Boolean).length;
        this.settings.count = n;
        new obsidian.Notice(`${n} words`);
        this.saveSettings();
      }
      return true;
    } });
    this.registerEvent(this.app.vault.on("modify", () => undefined));
  }
  async saveSettings() { await this.saveData(this.settings); }
}
module.exports = QuotePlugin;
