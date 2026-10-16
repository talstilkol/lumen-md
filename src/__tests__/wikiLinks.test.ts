import { describe, it, expect, vi } from "vitest";
import { handleWikiLinkClick, resolveWikiTarget, scrollToHeadingWhenRendered, splitWikiTarget } from "../renderer/wikiLinks";

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

describe("wiki-link fragments", () => {
  it("splits Note#Heading", () => {
    expect(splitWikiTarget("Guide#installation")).toEqual({ note: "Guide", heading: "installation" });
    expect(splitWikiTarget("Guide")).toEqual({ note: "Guide", heading: null });
    expect(splitWikiTarget("#Top")).toEqual({ note: "", heading: "Top" });
  });

  it("resolves the note before # and passes the heading through", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<a class="wiki-link" data-wiki-target="Guide#Installation" href="#guideinstallation">g</a>';
    document.body.appendChild(root);
    const open = vi.fn();
    const preventDefault = vi.fn();
    expect(handleWikiLinkClick({ target: root.querySelector("a"), preventDefault }, root, async () => ["Guide.md"], open)).toBe(true);
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("Guide.md", "Installation"));
    root.remove();
  });

  it("leaves a same-note [[#Heading]] alone", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a class="wiki-link" data-wiki-target="#Missing" href="#missing">g</a>';
    const preventDefault = vi.fn();
    expect(handleWikiLinkClick({ target: root.querySelector("a"), preventDefault }, root, async () => [], vi.fn())).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("scrolls to the heading once the opened note renders", () => {
    vi.useFakeTimers();
    const preview = document.createElement("div");
    preview.setAttribute("data-preview-root", "");
    document.body.appendChild(preview);
    scrollToHeadingWhenRendered("installation");
    vi.advanceTimersByTime(250);
    const h = document.createElement("h2");
    h.id = "installation";
    h.scrollIntoView = vi.fn();
    preview.appendChild(h);
    vi.advanceTimersByTime(150);
    expect(h.scrollIntoView).toHaveBeenCalled();
    preview.remove();
    vi.useRealTimers();
  });
});
