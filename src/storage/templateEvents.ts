/**
 * The window event an install of a marketplace template fires, so ⌘K can
 * reload its "Insert template" entries. Its own module so that
 * commands/installedTemplates.ts listens without importing
 * storage/templateMarketplace.ts at startup (that module loads on use).
 */
export const TEMPLATES_CHANGED_EVENT = "lumen:templates-changed";
