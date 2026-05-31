// @vitest-environment jsdom
/**
 * Proves the char-level CRDT editor binding (y-codemirror `ySync`) that
 * replaced the old full-document string mirror. The mirror re-sent the WHOLE
 * document on every change, so two people typing at once clobbered each other.
 * These tests show edits are now targeted Yjs ops that converge with BOTH
 * sides preserved.
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import { ySync, ySyncFacet, YSyncConfig } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";

function boundView(ytext: Y.Text, awareness: Awareness): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [ySyncFacet.of(new YSyncConfig(ytext, awareness)), ySync],
    }),
  });
}

describe("char-level CRDT editor binding (y-codemirror ySync)", () => {
  it("turns a local editor edit into a targeted Yjs op, not a full-doc replace", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("lumen");
    ytext.insert(0, "Hello world");
    const view = boundView(ytext, new Awareness(doc));

    let insertedChars = 0;
    ytext.observe((e) => {
      e.delta.forEach((d) => {
        if (typeof d.insert === "string") insertedChars += d.insert.length;
      });
    });

    view.dispatch({ changes: { from: 5, insert: " brave" } });

    expect(ytext.toString()).toBe("Hello brave world");
    // Only the 6 new chars were inserted — a full-doc mirror would have
    // re-inserted all 17.
    expect(insertedChars).toBe(" brave".length);
    view.destroy();
  });

  it("two peers converge under CONCURRENT edits with both preserved (no clobber)", () => {
    const docA = new Y.Doc();
    const ta = docA.getText("lumen");
    ta.insert(0, "shared text");
    const viewA = boundView(ta, new Awareness(docA));

    // Peer B joins and receives A's document.
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const tb = docB.getText("lumen");
    const viewB = boundView(tb, new Awareness(docB));
    expect(tb.toString()).toBe("shared text");

    // Both type at the same time, before any sync round-trip.
    viewA.dispatch({ changes: { from: 0, insert: "A>" } });
    viewB.dispatch({ changes: { from: tb.length, insert: "<B" } });

    // Exchange updates in both directions.
    const ua = Y.encodeStateAsUpdate(docA);
    const ub = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docA, ub);
    Y.applyUpdate(docB, ua);

    // Converged, and NEITHER edit was lost.
    expect(ta.toString()).toBe(tb.toString());
    expect(ta.toString()).toContain("A>");
    expect(ta.toString()).toContain("<B");
    expect(ta.toString()).toContain("shared text");
    viewA.destroy();
    viewB.destroy();
  });
});
