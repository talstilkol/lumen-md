/**
 * Dependency-free bridge from the command palette to the mounted WYSIWYG
 * editor's suggestion commands, so palette code doesn't pull Milkdown into
 * the main bundle. The WYSIWYG editor registers itself while mounted.
 */
export interface WysiwygSuggestActions {
  /** Accept / reject the change at the cursor; false when there is none. */
  resolve(mode: "accept" | "reject"): boolean;
  /** Move to the next (1) / previous (-1) change; false when there is none. */
  jump(dir: 1 | -1): boolean;
}

let actions: WysiwygSuggestActions | null = null;

export function setWysiwygSuggestActions(next: WysiwygSuggestActions | null): void {
  actions = next;
}

export function getWysiwygSuggestActions(): WysiwygSuggestActions | null {
  return actions;
}
