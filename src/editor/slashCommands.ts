/**
 * Slash Commands — inline command insertion triggered by typing "/" at
 * the start of a line. Provides a dropdown with insertable snippets.
 */

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  /** The markdown text to insert */
  template: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "table",
    label: "/table",
    description: "Insert a markdown table",
    template:
`| Column 1 | Column 2 | Column 3 |
|:---------|:--------:|----------:|
| Left     | Center   | Right     |
| Data     | Data     | Data      |`,
  },
  {
    id: "code",
    label: "/code",
    description: "Insert a fenced code block",
    template:
`\`\`\`javascript
// your code here
\`\`\``,
  },
  {
    id: "image",
    label: "/image",
    description: "Insert an image",
    template: `![Alt text](https://example.com/image.png)`,
  },
  {
    id: "link",
    label: "/link",
    description: "Insert a link",
    template: `[Link text](https://example.com)`,
  },
  {
    id: "heading",
    label: "/h2",
    description: "Insert heading (H2)",
    template: `## Heading`,
  },
  {
    id: "checklist",
    label: "/checklist",
    description: "Insert a task list",
    template:
`- [ ] Task 1
- [ ] Task 2
- [ ] Task 3`,
  },
  {
    id: "quote",
    label: "/quote",
    description: "Insert a blockquote",
    template:
`> Blockquote text here
>
> — Author`,
  },
  {
    id: "divider",
    label: "/hr",
    description: "Insert a horizontal rule",
    template: `---`,
  },
  {
    id: "callout",
    label: "/callout",
    description: "Insert a callout/admonition",
    template:
`:::note
This is an informational callout.
:::`,
  },
  {
    id: "math",
    label: "/math",
    description: "Insert a math block",
    template:
`$$
E = mc^2
$$`,
  },
  {
    id: "mermaid",
    label: "/mermaid",
    description: "Insert a Mermaid diagram",
    template:
`\`\`\`mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Done]
  B -->|No| D[Try again]
\`\`\``,
  },
  {
    id: "chart",
    label: "/chart",
    description: "Insert an EChart",
    template:
`\`\`\`chart
{
  "xAxis": { "type": "category", "data": ["A", "B", "C"] },
  "yAxis": { "type": "value" },
  "series": [{ "data": [120, 200, 150], "type": "bar" }]
}
\`\`\``,
  },
  {
    id: "footnote",
    label: "/footnote",
    description: "Insert a footnote",
    template: `Text with footnote[^1]

[^1]: Footnote content here.`,
  },
];

/**
 * Filter slash commands matching the current query.
 * @param query The text after "/" (e.g. "tab" from "/tab")
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  const lower = query.toLowerCase();
  return SLASH_COMMANDS.filter(
    (c) =>
      c.id.includes(lower) ||
      c.label.includes(lower) ||
      c.description.toLowerCase().includes(lower),
  );
}
