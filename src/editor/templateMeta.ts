/**
 * The built-in templates' ids, names and categories: what the command
 * palette lists at startup. Their content (editor/templates.ts) loads when
 * one is chosen. templateMeta.test.ts keeps the two lists equal.
 */
export interface TemplateMeta {
  id: string;
  name: string;
  category: string;
}

export const TEMPLATE_META: readonly TemplateMeta[] = [
  { id: "meeting-notes", name: "Meeting Notes", category: "Business" },
  { id: "blog-post", name: "Blog Post", category: "Writing" },
  { id: "thesis", name: "Academic Paper", category: "Academic" },
  { id: "project-readme", name: "Project README", category: "Development" },
  { id: "weekly-review", name: "Weekly Review", category: "Productivity" },
  { id: "changelog", name: "Changelog", category: "Development" },
  { id: "lesson-plan", name: "Lesson Plan", category: "Education" },
];
