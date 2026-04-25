/**
 * Template Gallery — provides ready-made document templates
 * that users can insert to quickly start structured documents.
 */

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    description: "Structured meeting minutes template",
    category: "Business",
    content: `# Meeting Notes

**Date:** ${new Date().toISOString().split("T")[0]}
**Attendees:** 
**Location:** 

---

## Agenda
1. 
2. 
3. 

## Discussion Points

### Topic 1


### Topic 2


## Action Items
- [ ] 
- [ ] 
- [ ] 

## Next Meeting
**Date:** 
**Topics:** 
`,
  },
  {
    id: "blog-post",
    name: "Blog Post",
    description: "Standard blog post with metadata",
    category: "Writing",
    content: `---
title: "Your Blog Post Title"
date: ${new Date().toISOString().split("T")[0]}
author: ""
tags: []
---

# Your Blog Post Title

> A compelling introduction that hooks the reader.

## Introduction

Start with context and why this topic matters.

## Main Content

### Key Point 1

Explain your first main point with supporting evidence.

### Key Point 2

Discuss your second point in detail.

### Key Point 3

Present your third argument or insight.

## Conclusion

Summarize the main takeaways and include a call to action.

---

*Thanks for reading! Share your thoughts in the comments below.*
`,
  },
  {
    id: "thesis",
    name: "Academic Paper",
    description: "Research paper structure with abstract",
    category: "Academic",
    content: `# Paper Title

**Author:** Your Name  
**Institution:** University Name  
**Date:** ${new Date().toISOString().split("T")[0]}

---

## Abstract

A concise summary of the research (150-300 words).

**Keywords:** keyword1, keyword2, keyword3

## 1. Introduction

Background context, research question, and objectives.

## 2. Literature Review

Summary of existing research and theoretical framework.

## 3. Methodology

Research design, data collection, and analysis methods.

## 4. Results

Key findings presented with supporting data.

## 5. Discussion

Interpretation of results, implications, and limitations.

## 6. Conclusion

Summary of findings and recommendations for future research.

## References

1. Author, A. (Year). Title. *Journal*, Vol(Issue), Pages.
2. Author, B. (Year). Title. *Publisher*.
`,
  },
  {
    id: "project-readme",
    name: "Project README",
    description: "Open-source project documentation",
    category: "Development",
    content: `# Project Name

[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

> Brief description of what this project does.

## Features

- ✨ Feature 1
- 🚀 Feature 2
- 🔒 Feature 3

## Quick Start

\`\`\`bash
# Clone the repository
git clone https://github.com/username/project.git

# Install dependencies
npm install

# Start development server
npm run dev
\`\`\`

## Usage

\`\`\`javascript
import { example } from 'project';

example.doSomething();
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`init()\` | Initialize the library |
| \`run()\` | Execute the main process |

## Contributing

1. Fork the repository
2. Create your feature branch (\`git checkout -b feature/amazing\`)
3. Commit your changes (\`git commit -m 'Add amazing feature'\`)
4. Push to the branch (\`git push origin feature/amazing\`)
5. Open a Pull Request

## License

MIT © [Your Name]
`,
  },
  {
    id: "weekly-review",
    name: "Weekly Review",
    description: "Personal productivity review template",
    category: "Productivity",
    content: `# Weekly Review — Week of ${new Date().toISOString().split("T")[0]}

## 🎯 Goals for This Week
- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

## ✅ Accomplished
- 
- 
- 

## 🚧 In Progress
- 
- 

## 🧠 Lessons Learned
- 

## 📋 Next Week's Priorities
1. 
2. 
3. 

## 📊 Metrics
| Area | Target | Actual |
|------|--------|--------|
|      |        |        |

## 💡 Ideas & Notes
- 
`,
  },
  {
    id: "changelog",
    name: "Changelog",
    description: "Keep a Changelog format",
    category: "Development",
    content: `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- 

### Changed
- 

### Fixed
- 

## [1.0.0] - ${new Date().toISOString().split("T")[0]}

### Added
- Initial release
`,
  },
  {
    id: "lesson-plan",
    name: "Lesson Plan",
    description: "Teaching lesson plan template",
    category: "Education",
    content: `# Lesson Plan: Topic Name

**Subject:** 
**Grade/Level:** 
**Duration:** 45 minutes

---

## Learning Objectives
By the end of this lesson, students will be able to:
1. 
2. 
3. 

## Materials Needed
- 
- 

## Lesson Outline

### Warm-Up (5 min)
- 

### Introduction (10 min)
- 

### Main Activity (20 min)
- 

### Practice (5 min)
- 

### Wrap-Up (5 min)
- 

## Assessment
- 

## Homework
- 

## Notes / Differentiation
- 
`,
  },
];

export function getTemplateCategories(): string[] {
  return [...new Set(TEMPLATES.map((t) => t.category))];
}

export function filterTemplates(category?: string, query?: string): Template[] {
  let results = TEMPLATES;
  if (category) results = results.filter((t) => t.category === category);
  if (query) {
    const lower = query.toLowerCase();
    results = results.filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower),
    );
  }
  return results;
}
