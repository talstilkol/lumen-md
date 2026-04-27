/**
 * Tests for the inline-comments module. We exercise the full lifecycle
 * (add → reply → resolve → unresolve → delete) on a real Y.Doc + Y.Text
 * so anchor encoding actually round-trips.
 *
 * Also pins the critical property: when text is inserted before a
 * comment's anchor, the resolved positions shift to track it (that's
 * the whole point of using RelativePosition).
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import {
  addComment,
  deleteComment,
  getCommentsMap,
  listComments,
  onCommentsChanged,
  replyToComment,
  resolveAnchor,
  toggleResolved,
} from "../collab/comments";

const AUTHOR = { name: "Alice", color: "hsl(280 70% 60%)" };

let doc: Y.Doc;
let ytext: Y.Text;

beforeEach(() => {
  doc = new Y.Doc();
  ytext = doc.getText("lumen");
  ytext.insert(0, "Hello world, this is the second sentence.");
});

describe("comments — basic lifecycle", () => {
  it("starts empty", () => {
    expect(listComments(doc)).toEqual([]);
  });

  it("addComment stores under the shared map and is listable", () => {
    const c = addComment(doc, ytext, "first comment", 0, 5, AUTHOR);
    expect(c.body).toBe("first comment");
    expect(c.authorName).toBe("Alice");
    expect(listComments(doc)).toHaveLength(1);
    expect(getCommentsMap(doc).size).toBe(1);
  });

  it("replyToComment appends to replies array", () => {
    const c = addComment(doc, ytext, "main", 0, 5, AUTHOR);
    replyToComment(doc, c.id, "first reply", { name: "Bob", color: "hsl(180 70% 60%)" });
    replyToComment(doc, c.id, "second reply", AUTHOR);
    const reloaded = getCommentsMap(doc).get(c.id)!;
    expect(reloaded.replies).toHaveLength(2);
    expect(reloaded.replies[0].authorName).toBe("Bob");
  });

  it("toggleResolved flips resolvedAt", () => {
    const c = addComment(doc, ytext, "main", 0, 5, AUTHOR);
    toggleResolved(doc, c.id);
    expect(getCommentsMap(doc).get(c.id)!.resolvedAt).not.toBeNull();
    toggleResolved(doc, c.id);
    expect(getCommentsMap(doc).get(c.id)!.resolvedAt).toBeNull();
  });

  it("deleteComment removes from the map", () => {
    const c = addComment(doc, ytext, "main", 0, 5, AUTHOR);
    deleteComment(doc, c.id);
    expect(getCommentsMap(doc).has(c.id)).toBe(false);
    expect(listComments(doc)).toHaveLength(0);
  });
});

describe("comments — anchor stability", () => {
  it("resolveAnchor yields the original positions just after add", () => {
    const c = addComment(doc, ytext, "x", 6, 11, AUTHOR); // "world"
    const a = resolveAnchor(doc, c);
    expect(a).toEqual({ from: 6, to: 11 });
  });

  it("anchor shifts forward when text is inserted before it (the whole point of RelativePosition)", () => {
    const c = addComment(doc, ytext, "x", 6, 11, AUTHOR); // "world"
    ytext.insert(0, "PREFIX ");
    const a = resolveAnchor(doc, c);
    expect(a).not.toBeNull();
    expect(a!.from).toBe(13); // 6 + 7 ("PREFIX ".length)
    expect(a!.to).toBe(18);   // 11 + 7
    // Sanity: the resolved range still covers "world" verbatim.
    expect(ytext.toString().slice(a!.from, a!.to)).toBe("world");
  });

  it("anchor stays put when text is inserted after it", () => {
    const c = addComment(doc, ytext, "x", 6, 11, AUTHOR);
    ytext.insert(20, " EXTRA");
    expect(resolveAnchor(doc, c)).toEqual({ from: 6, to: 11 });
  });
});

describe("comments — listComments filtering", () => {
  it("onlyOpen drops resolved comments", () => {
    const a = addComment(doc, ytext, "open", 0, 5, AUTHOR);
    const b = addComment(doc, ytext, "closed", 6, 11, AUTHOR);
    toggleResolved(doc, b.id);
    expect(listComments(doc, { onlyOpen: true }).map((c) => c.id)).toEqual([a.id]);
    expect(listComments(doc).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("listComments returns newest first", async () => {
    const c1 = addComment(doc, ytext, "first", 0, 5, AUTHOR);
    // Tiny delay so createdAt differs
    await new Promise((r) => setTimeout(r, 5));
    const c2 = addComment(doc, ytext, "second", 6, 11, AUTHOR);
    expect(listComments(doc)[0].id).toBe(c2.id);
    expect(listComments(doc)[1].id).toBe(c1.id);
  });
});

describe("comments — observer", () => {
  it("onCommentsChanged fires for every mutation", async () => {
    let calls = 0;
    const off = onCommentsChanged(doc, () => calls++);
    const c = addComment(doc, ytext, "x", 0, 5, AUTHOR);
    replyToComment(doc, c.id, "y", AUTHOR);
    toggleResolved(doc, c.id);
    deleteComment(doc, c.id);
    // Each mutation runs through Y.Map.set/delete which yields the
    // observer once per transaction.
    expect(calls).toBeGreaterThanOrEqual(4);
    off();
  });
});
