/**
 * Plan 0.2: the palette's command domains load in their own chunk
 * (commands/sectionsLoader.ts). A test that builds the list with
 * useCommands and reads it synchronously imports this file first.
 */
import { beforeAll } from "vitest";
import { loadCommandSections } from "../../commands/sectionsLoader";

beforeAll(async () => {
  await loadCommandSections();
});
