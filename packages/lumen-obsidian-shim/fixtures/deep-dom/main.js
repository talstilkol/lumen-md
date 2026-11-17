"use strict";
var obsidian = require("obsidian");
module.exports = class extends obsidian.Plugin {
  onload() {
    const nav = this.app.workspace.containerEl.querySelector(".nav-files-container");
    nav.style.fontSize = "12px";
  }
};
