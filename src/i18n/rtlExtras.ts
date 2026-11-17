/**
 * What an Arabic or Persian UI loads besides its strings (plan W13.I5,
 * W13.I7), in its own lazy chunk — nothing here is in the startup bundle:
 *
 *   - the Naskh face (Noto Naskh Arabic, SIL OFL 1.1, public/fonts/reading/),
 *     from this app's own origin, only for Arabic-script text
 *     (unicode-range), before the system fallback;
 *   - justification by word space only: no kashida (tatweel) stretching;
 *   - the welcome note and the templates in the language (./rtlContent).
 */
import { registerRtlContent } from "../welcomeDoc";

export const NASKH_FAMILY = "Lumen Noto Naskh Arabic";
export const NASKH_FILE = "fonts/reading/noto-naskh-arabic.woff";
const STYLE_ID = "lumen-rtl-extras";

/** The CSS: the face, the font stacks for ar / fa, and word-space justification. */
export function rtlExtrasCss(base: string): string {
  const url = `${base.replace(/\/?$/, "/")}${NASKH_FILE}`;
  return [
    `@font-face{font-family:"${NASKH_FAMILY}";src:url("${url}") format("woff");font-weight:400 700;font-style:normal;font-display:swap;` +
      "unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+25CC,U+FB50-FDFF,U+FE70-FEFF}",
    `:root:lang(ar),:root:lang(fa){--font-sans:Inter,"${NASKH_FAMILY}",Heebo,ui-sans-serif,system-ui,sans-serif;--font-serif:"Source Serif 4","${NASKH_FAMILY}","Frank Ruhl Libre",ui-serif,serif}`,
    // Justified Arabic-script text stretches words with kashida in some engines; word spacing only.
    ":root:lang(ar) *,:root:lang(fa) *{text-justify:inter-word}",
  ].join("\n");
}

/** Installs the style once (idempotent) and the language's welcome note and templates. */
export async function applyRtlExtras(locale: string, doc: Document | undefined = typeof document !== "undefined" ? document : undefined): Promise<void> {
  if (doc && !doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = rtlExtrasCss(import.meta.env?.BASE_URL ?? "/");
    doc.head.appendChild(style);
  }
  const content = await import("./rtlContent");
  registerRtlContent(locale, content.welcomeFor(locale), content.templatesFor(locale));
}
