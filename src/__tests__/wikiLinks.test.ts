import { describe, it, expect, vi } from "vitest";
import { handleWikiLinkClick, resolveWikiTarget } from "../renderer/wikiLinks";

describe("resolveWikiTarget", () => {
  const paths = ["Start Here.md", "Project Board.md", "Projects/Website Redesign.md", "Metrics.markdown"];
  it("matches by file name or path, case-insensitively, with or without extension", () => {
    expect(resolveWikiTarget("Project Board", paths)).toBe("Project Board.md");
    expect(resolveWikiTarget("website redesign", paths)).toBe("Projects/Website Redesign.md");
    expect(resolveWikiTarget("Projects/Website Redesign.md", paths)).toBe("Projects/Website Redesign.md");
    expect(resolveWikiTarget("metrics", paths)).toBe("Metrics.markdown");
    expect(resolveWikiTarget("Nope", paths)).toBeNull();
  });
});

describe("handleWikiLinkClick", () => {
  function setup(html: string) {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it("opens the matching workspace note when the target isn't a heading here", async () => {
    const root = setup('<a class="wiki-link" data-wiki-target="Metrics" href="#metrics"><span>wiki-link</span></a>');
    const open = vi.fn();
    const preventDefault = vi.fn();
    const handled = handleWikiLinkClick(
      { target: root.querySelector("span"), preventDefault },
      root,
      async () => ["Start Here.md", "Metrics.md"],
      open,
    );
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("Metrics.md"));
    root.remove();
  });

  it("keeps the in-page jump when the note has that heading", () => {
    const root = setup('<h2 id="metrics">Metrics</h2><a class="wiki-link" data-wiki-target="Metrics" href="#metrics">m</a>');
    const open = vi.fn();
    const preventDefault = vi.fn();
    expect(handleWikiLinkClick({ target: root.querySelector("a"), preventDefault }, root, async () => [], open)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    root.remove();
  });
});
