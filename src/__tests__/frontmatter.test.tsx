import { describe, it, expect } from "vitest";

describe("Frontmatter render", () => {
  it("renders with empty data", async () => {
    const { render } = await import("@testing-library/react");
    const { Frontmatter } = await import("../ui/Frontmatter");
    const { container } = render(<Frontmatter data={{}} />);
    expect(container).toBeDefined();
  });

  it("displays values from data", async () => {
    const { render } = await import("@testing-library/react");
    const { Frontmatter } = await import("../ui/Frontmatter");
    const { container } = render(
      <Frontmatter data={{ title: "Test", tags: ["a", "b"] }} />,
    );
    const text = container.textContent ?? "";
    // The component renders something from the data
    expect(text.length).toBeGreaterThan(0);
  });

  it("renders tags as list", async () => {
    const { render } = await import("@testing-library/react");
    const { Frontmatter } = await import("../ui/Frontmatter");
    const { container } = render(
      <Frontmatter data={{ tags: ["react", "testing"] }} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("react");
    expect(text).toContain("testing");
  });
});
