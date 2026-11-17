# Smart-list golden cases (plan W13.E2)

One case per behaviour: the text before (caret `‸`, or a selection from `⟦`
anchor to `⟧` head), one operation, the text after. `"after": null` means the
operation does not apply there and the editor's own key handling runs.

Sources: the list changes of Obsidian 1.14.0 (smarter list paste,
partial-selection formatting) and 1.15.1 (over-indent, moving nested items),
CommonMark list rules, and Hebrew numbered lists (W13.H5).

`src/__tests__/smartListsGolden.test.ts` runs every case through the pure
engine (src/editor/smartLists.ts) and through a real CodeMirror state
(src/editor/smartListsExtension.ts); the Milkdown runner is in the same file.
