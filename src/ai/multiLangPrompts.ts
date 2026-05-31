/**
 * Multi-language AI Prompt Templates.
 * 
 * Provides pre-built prompt templates for 12 languages: Hebrew, Arabic,
 * Russian, English, Spanish, French, German, Portuguese, Italian, Chinese,
 * Japanese and Korean. Each template is written in the target language and
 * optimized for its conventions.
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

  // ── Spanish Templates ─────────────────────────────────────────────────
  {
    id: "es.summarize",
    label: "📝 Resumen en español",
    lang: "es",
    prompt: "Resume el siguiente texto en español de forma concisa y clara, conservando los puntos principales:\n\n{content}",
    category: "writing",
  },
  {
    id: "es.improve",
    label: "✨ Mejorar redacción",
    lang: "es",
    prompt: "Mejora el siguiente texto en español. Corrige errores gramaticales y mejora el estilo, conservando el significado original:\n\n{content}",
    category: "editing",
  },

  // ── French Templates ──────────────────────────────────────────────────
  {
    id: "fr.summarize",
    label: "📝 Résumé en français",
    lang: "fr",
    prompt: "Résumez le texte suivant en français de manière concise et claire, en conservant les points principaux :\n\n{content}",
    category: "writing",
  },
  {
    id: "fr.improve",
    label: "✨ Améliorer la rédaction",
    lang: "fr",
    prompt: "Améliorez le texte suivant en français. Corrigez les fautes de grammaire et améliorez le style, en conservant le sens original :\n\n{content}",
    category: "editing",
  },

  // ── German Templates ──────────────────────────────────────────────────
  {
    id: "de.summarize",
    label: "📝 Zusammenfassung auf Deutsch",
    lang: "de",
    prompt: "Fassen Sie den folgenden Text auf Deutsch prägnant und klar zusammen und behalten Sie die wichtigsten Punkte bei:\n\n{content}",
    category: "writing",
  },
  {
    id: "de.improve",
    label: "✨ Text verbessern",
    lang: "de",
    prompt: "Verbessern Sie den folgenden deutschen Text. Korrigieren Sie Grammatikfehler und verbessern Sie den Stil, ohne die ursprüngliche Bedeutung zu verändern:\n\n{content}",
    category: "editing",
  },

  // ── Portuguese Templates ──────────────────────────────────────────────
  {
    id: "pt.summarize",
    label: "📝 Resumo em português",
    lang: "pt",
    prompt: "Resuma o seguinte texto em português de forma concisa e clara, mantendo os pontos principais:\n\n{content}",
    category: "writing",
  },
  {
    id: "pt.improve",
    label: "✨ Melhorar a escrita",
    lang: "pt",
    prompt: "Melhore o seguinte texto em português. Corrija erros gramaticais e melhore o estilo, mantendo o significado original:\n\n{content}",
    category: "editing",
  },

  // ── Italian Templates ─────────────────────────────────────────────────
  {
    id: "it.summarize",
    label: "📝 Riassunto in italiano",
    lang: "it",
    prompt: "Riassumi il seguente testo in italiano in modo conciso e chiaro, mantenendo i punti principali:\n\n{content}",
    category: "writing",
  },
  {
    id: "it.improve",
    label: "✨ Migliorare la scrittura",
    lang: "it",
    prompt: "Migliora il seguente testo in italiano. Correggi gli errori grammaticali e migliora lo stile, mantenendo il significato originale:\n\n{content}",
    category: "editing",
  },

  // ── Chinese Templates ─────────────────────────────────────────────────
  {
    id: "zh.summarize",
    label: "📝 中文摘要",
    lang: "zh",
    prompt: "用简洁清晰的中文总结以下文本，保留要点：\n\n{content}",
    category: "writing",
  },
  {
    id: "zh.improve",
    label: "✨ 改进写作",
    lang: "zh",
    prompt: "改进以下中文文本。修正语法错误并改善文风，同时保留原意：\n\n{content}",
    category: "editing",
  },

  // ── Japanese Templates ────────────────────────────────────────────────
  {
    id: "ja.summarize",
    label: "📝 日本語で要約",
    lang: "ja",
    prompt: "次のテキストを日本語で簡潔かつ明確に要約し、要点を保持してください：\n\n{content}",
    category: "writing",
  },
  {
    id: "ja.improve",
    label: "✨ 文章を改善",
    lang: "ja",
    prompt: "次の日本語のテキストを改善してください。文法の誤りを修正し、元の意味を保ちながら文体を向上させてください：\n\n{content}",
    category: "editing",
  },

  // ── Korean Templates ──────────────────────────────────────────────────
  {
    id: "ko.summarize",
    label: "📝 한국어 요약",
    lang: "ko",
    prompt: "다음 텍스트를 한국어로 간결하고 명확하게 요약하고 핵심을 유지하세요:\n\n{content}",
    category: "writing",
  },
  {
    id: "ko.improve",
    label: "✨ 글쓰기 개선",
    lang: "ko",
    prompt: "다음 한국어 텍스트를 개선하세요. 문법 오류를 수정하고 원래 의미를 유지하면서 문체를 향상시키세요:\n\n{content}",
    category: "editing",
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
