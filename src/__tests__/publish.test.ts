/**
 * Tests for the slug helpers in publish.ts (P3-08). We can't exercise the
 * fetch path without a fake server — that's covered by the operator-side
 * worker. The helpers below are pure markdown manipulation worth pinning.
 */

import { describe, it, expect } from "vitest";
import { getPublishedSlug } from "../sync/publish";

describe("getPublishedSlug", () => {
  it("returns null when there's no frontmatter", () => {
    expect(getPublishedSlug("# Hi\n\nSome text")).toBeNull();
  });

  it("returns null when frontmatter has no published key", () => {
    expect(getPublishedSlug("---\ntitle: Foo\n---\n\nbody")).toBeNull();
  });

  it("returns the slug when present", () => {
    expect(
      getPublishedSlug("---\ntitle: Foo\npublished: my-cool-note\n---\n\nbody"),
    ).toBe("my-cool-note");
  });

  it("supports slugs with slashes (namespacing)", () => {
    expect(getPublishedSlug("---\npublished: 2026/launch-plan\n---\n\nbody")).toBe(
      "2026/launch-plan",
    );
  });
});
