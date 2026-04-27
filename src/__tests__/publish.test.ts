/**
 * Tests for the slug helpers in publish.ts (P3-08). We can't exercise the
 * fetch path without a fake server — that's covered by the operator-side
 * worker. The helpers below are pure markdown manipulation worth pinning.
 */

import { describe, it, expect } from "vitest";
import { getPublishedSlug, setPublishedSlug } from "../sync/publish";

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

describe("setPublishedSlug", () => {
  it("creates frontmatter when none exists", () => {
    const out = setPublishedSlug("just body", "my-slug");
    expect(out.startsWith("---\npublished: my-slug\n---\n\n")).toBe(true);
    expect(out.endsWith("just body")).toBe(true);
  });

  it("inserts into existing frontmatter", () => {
    const input = "---\ntitle: Foo\n---\n\nbody";
    const out = setPublishedSlug(input, "abc-123");
    expect(getPublishedSlug(out)).toBe("abc-123");
    // Title preserved.
    expect(out).toContain("title: Foo");
  });

  it("replaces an existing slug", () => {
    const input = "---\npublished: old-slug\n---\n\nbody";
    const out = setPublishedSlug(input, "new-slug");
    expect(getPublishedSlug(out)).toBe("new-slug");
    expect(out).not.toContain("old-slug");
  });

  it("removes the slug when set to null", () => {
    const input = "---\ntitle: Foo\npublished: gone\n---\n\nbody";
    const out = setPublishedSlug(input, null);
    expect(getPublishedSlug(out)).toBeNull();
    expect(out).toContain("title: Foo");
  });

  it("is idempotent — setting the same slug twice yields equal output", () => {
    const input = "---\ntitle: Foo\n---\n\nbody";
    const a = setPublishedSlug(input, "stable");
    const b = setPublishedSlug(a, "stable");
    expect(a).toBe(b);
  });
});
