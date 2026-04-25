/**
 * Multi-language AI Prompt Templates.
 * 
 * Provides pre-built prompt templates for Hebrew, Arabic, Russian, and English.
 * Each template is designed for common writing tasks and optimized for the
 * target language's conventions.
 */

export interface AiPromptTemplate {
  id: string;
  label: string;
  lang: string;
  prompt: string;
  category: "writing" | "editing" | "translation" | "analysis" | "code";
}

export const AI_PROMPT_TEMPLATES: AiPromptTemplate[] = [
  // ── Hebrew Templates ──────────────────────────────────────────────────
  {
    id: "he.summarize",
    label: "📝 סיכום בעברית",
    lang: "he",
    prompt: "סכם את הטקסט הבא בעברית, בצורה תמציתית וברורה. שמור על הנקודות העיקריות:\n\n{content}",
    category: "writing",
  },
  {
    id: "he.improve",
    label: "✨ שיפור כתיבה בעברית",
    lang: "he",
    prompt: "שפר את הטקסט הבא בעברית. תקן שגיאות דקדוק, שפר את הסגנון, ושמור על המשמעות המקורית:\n\n{content}",
    category: "editing",
  },
  {
    id: "he.translate_to_en",
    label: "🌐 תרגום עברית → אנגלית",
    lang: "he",
    prompt: "Translate the following Hebrew text to fluent, natural English:\n\n{content}",
    category: "translation",
  },
  {
    id: "he.formal",
    label: "📄 המרה לשפה רשמית",
    lang: "he",
    prompt: "המר את הטקסט הבא לשפה רשמית ומקצועית בעברית:\n\n{content}",
    category: "editing",
  },
  {
    id: "he.explain",
    label: "🎓 הסבר פשוט בעברית",
    lang: "he",
    prompt: "הסבר את המושג הבא בעברית פשוטה, כאילו אתה מסביר לתלמיד בבית ספר תיכון:\n\n{content}",
    category: "analysis",
  },

  // ── Arabic Templates ──────────────────────────────────────────────────
  {
    id: "ar.summarize",
    label: "📝 تلخيص بالعربية",
    lang: "ar",
    prompt: "لخص النص التالي باللغة العربية بشكل موجز وواضح. حافظ على النقاط الرئيسية:\n\n{content}",
    category: "writing",
  },
  {
    id: "ar.improve",
    label: "✨ تحسين الكتابة بالعربية",
    lang: "ar",
    prompt: "حسّن النص التالي باللغة العربية. صحح الأخطاء النحوية وحسّن الأسلوب مع الحفاظ على المعنى الأصلي:\n\n{content}",
    category: "editing",
  },
  {
    id: "ar.translate_to_en",
    label: "🌐 ترجمة عربي → إنجليزي",
    lang: "ar",
    prompt: "Translate the following Arabic text to fluent, natural English:\n\n{content}",
    category: "translation",
  },

  // ── Russian Templates ─────────────────────────────────────────────────
  {
    id: "ru.summarize",
    label: "📝 Резюме на русском",
    lang: "ru",
    prompt: "Кратко изложите следующий текст на русском языке. Сохраните основные моменты:\n\n{content}",
    category: "writing",
  },
  {
    id: "ru.improve",
    label: "✨ Улучшение текста",
    lang: "ru",
    prompt: "Улучшите следующий текст на русском языке. Исправьте грамматические ошибки и улучшите стиль, сохраняя первоначальное значение:\n\n{content}",
    category: "editing",
  },
  {
    id: "ru.translate_to_en",
    label: "🌐 Перевод рус → англ",
    lang: "ru",
    prompt: "Translate the following Russian text to fluent, natural English:\n\n{content}",
    category: "translation",
  },

  // ── English Templates ─────────────────────────────────────────────────
  {
    id: "en.summarize",
    label: "📝 Summarize in English",
    lang: "en",
    prompt: "Summarize the following text concisely. Keep the key points:\n\n{content}",
    category: "writing",
  },
  {
    id: "en.improve",
    label: "✨ Improve Writing",
    lang: "en",
    prompt: "Improve the following text. Fix grammar, enhance style, and maintain the original meaning:\n\n{content}",
    category: "editing",
  },
  {
    id: "en.simplify",
    label: "🎓 Simplify / ELI5",
    lang: "en",
    prompt: "Explain the following concept in simple terms, as if explaining to a high school student:\n\n{content}",
    category: "analysis",
  },
  {
    id: "en.code_review",
    label: "🔍 Code Review",
    lang: "en",
    prompt: "Review the following code. Identify bugs, suggest improvements, and check for best practices:\n\n{content}",
    category: "code",
  },
  {
    id: "en.blog_post",
    label: "📰 Blog Post Draft",
    lang: "en",
    prompt: "Write a compelling blog post based on the following notes. Use markdown formatting with headers, bullet points, and a compelling introduction:\n\n{content}",
    category: "writing",
  },
  {
    id: "en.translate_to_he",
    label: "🌐 English → Hebrew",
    lang: "en",
    prompt: "תרגם את הטקסט הבא לעברית טבעית ושוטפת:\n\n{content}",
    category: "translation",
  },
];

/** Get templates filtered by language */
export function getTemplatesByLang(lang: string): AiPromptTemplate[] {
  return AI_PROMPT_TEMPLATES.filter((t) => t.lang === lang);
}

/** Get templates filtered by category */
export function getTemplatesByCategory(category: AiPromptTemplate["category"]): AiPromptTemplate[] {
  return AI_PROMPT_TEMPLATES.filter((t) => t.category === category);
}

/** Apply a template by replacing {content} with the actual content */
export function applyTemplate(template: AiPromptTemplate, content: string): string {
  return template.prompt.replace("{content}", content);
}
