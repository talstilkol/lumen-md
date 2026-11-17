/**
 * W10.E15, wave g5: the automations' own lines read right in Hebrew. A new
 * rule's default name and the dry run's "from → to" used a hard-coded "→",
 * which points backwards in a right-to-left line, and a path such as
 * "Projects/חתונה.md" inside a Hebrew line came out as "md.חתונה/Projects".
 * The arrow now follows the UI's direction and every path, rule and agent
 * name is isolated (FSI … PDI).
 */
import { describe, it, expect } from "vitest";
import { ACTIONS, defaultRuleName, dryRunLine, flowArrow } from "../commands/domains/automationsActions";
import { FSI, PDI } from "../graph/labels";

const strip = (s: string) => s.replace(/[⁦-⁩]/g, "");

describe("automations in a right-to-left UI", () => {
  it("the arrow follows the reading direction", () => {
    expect(flowArrow("ltr")).toBe("→");
    expect(flowArrow("rtl")).toBe("←");
    expect(defaultRuleName("נוצר פתק", "להוסיף משימה", "rtl")).toBe("נוצר פתק ← להוסיף משימה");
    expect(defaultRuleName("A note is created", "Add a task", "ltr")).toBe("A note is created → Add a task");
  });

  it("a move in the dry run: both paths isolated, the arrow in the UI's direction", () => {
    const line = dryRunLine({ kind: "move", from: "Inbox/חתונה.md", to: "Projects/חתונה.md", rule: "לסדר" }, "rtl");
    expect(line).toBe(`• ${FSI}לסדר${PDI}: ${FSI}Inbox/חתונה.md${PDI} ← ${FSI}Projects/חתונה.md${PDI}`);
    expect(strip(dryRunLine({ kind: "move", from: "a.md", to: "b/a.md", rule: "r" }, "ltr"))).toBe("• r: a.md → b/a.md");
  });

  it("a write and an agent run name their note, isolated", () => {
    expect(dryRunLine({ kind: "write", path: "Tasks.md", before: null, after: "- [ ] x\n", rule: "r" }, "rtl")).toBe(`• ${FSI}r${PDI}: ${FSI}Tasks.md${PDI}`);
    const agent = dryRunLine({ kind: "agent", agent: "summarize", path: "Inbox/פגישה.md", prompt: "", rule: "r" }, "rtl");
    expect(agent).toContain(`${FSI}Inbox/פגישה.md${PDI}`);
    expect(agent).toContain(`${FSI}summarize${PDI}`);
  });

  it("still offers the six actions", () => {
    expect([...ACTIONS]).toEqual(["move", "tag", "template", "appendDaily", "createTask", "runAgent"]);
  });
});
