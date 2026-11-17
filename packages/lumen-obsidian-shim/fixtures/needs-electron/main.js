"use strict";
var obsidian = require("obsidian");
var electron = require("electron");
module.exports = class extends obsidian.Plugin { onload() { this.addCommand({ id: "open", name: "Open", callback: () => electron.shell.openPath("/") }); } };
