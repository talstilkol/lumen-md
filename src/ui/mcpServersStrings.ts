/**
 * English strings used only by the MCP servers settings tab and the MCP
 * dialogs (plan W7.18, W10.C2), which load on demand: they travel with that
 * chunk (src/i18n/lazy/mcpServers.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/mcpServers.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
