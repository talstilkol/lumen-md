import { t } from "../i18n";

export interface Template {
  id: string;
  name: string;
  description: string;
  emoji: string;
  content: string;
}

export function getTemplates(): Template[] {
  return [
    {
      id: "blank",
      name: t("template.blank") ?? "Blank document",
      description: t("template.blank.desc") ?? "Start with a clean slate",
      emoji: "📄",
      content: "# Untitled\n\n",
    },
    {
      id: "meeting",
      name: t("template.meeting") ?? "Meeting notes",
      description: t("template.meeting.desc") ?? "Date, attendees, agenda, action items",
      emoji: "📋",
      content: `# Meeting Notes

**Date:** ${new Date().toISOString().slice(0, 10)}
**Attendees:** 

## Agenda

1. 

## Discussion

- 

## Action Items

- [ ] 
- [ ] 
`,
    },
    {
      id: "journal",
      name: t("template.journal") ?? "Daily journal",
      description: t("template.journal.desc") ?? "Gratitude, goals, reflections",
      emoji: "📓",
      content: `# ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}

## 🙏 Gratitude
1. 
2. 
3. 

## 🎯 Today's Goals
- [ ] 
- [ ] 
- [ ] 

## 💭 Reflections


## 📝 Notes

`,
    },
    {
      id: "blog",
      name: t("template.blog") ?? "Blog post",
      description: t("template.blog.desc") ?? "Title, intro, sections, conclusion",
      emoji: "✍️",
      content: `# Blog Post Title

> A compelling subtitle or hook that draws readers in.

## Introduction

Start with context — why should the reader care?

## Main Point

Your key argument or insight goes here.

### Supporting Evidence

- Point 1
- Point 2

## Conclusion

Wrap up with a takeaway or call to action.

---

*Written with [Lumen](https://lumen.md)*
`,
    },
    {
      id: "readme",
      name: t("template.readme") ?? "Project README",
      description: t("template.readme.desc") ?? "Standard open-source README structure",
      emoji: "🛠️",
      content: `# Project Name

Brief description of what this project does.

## Installation

\`\`\`bash
npm install project-name
\`\`\`

## Usage

\`\`\`javascript
import { feature } from "project-name";
\`\`\`

## API Reference

| Function | Description | Returns |
|----------|-------------|---------|
| \`init()\` | Initializes the project | \`void\` |

## Contributing

1. Fork the repository
2. Create your feature branch (\`git checkout -b feature/amazing\`)
3. Commit your changes (\`git commit -m 'Add amazing feature'\`)
4. Push to the branch (\`git push origin feature/amazing\`)
5. Open a Pull Request

## License

MIT
`,
    },
    {
      id: "letter",
      name: t("template.letter") ?? "Formal letter",
      description: t("template.letter.desc") ?? "Professional letter format",
      emoji: "✉️",
      content: `**Your Name**
Your Address
City, ZIP

${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

**Recipient Name**
Title
Organization

Dear [Name],

I am writing to...

Thank you for your consideration.

Sincerely,

**Your Name**
`,
    },
  ];
}
