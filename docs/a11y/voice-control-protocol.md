# Speech input: Voice Control and Voice Access protocol (plan W13.Y3)

Speech-input users operate the app by saying what they see: "click
Restore", "tap Move later". That works only when each control's accessible
name contains its visible text (WCAG 2.5.3) and icon-only controls have short,
consistent names. The automated half is `src/__tests__/labelInName.test.ts`
(every control in the source, English and Hebrew) and the browser gate in
`e2e/a11y.spec.ts` (rendered names on ten surfaces). This is the manual half,
once per release, in English and in Hebrew.

**Platforms:** macOS Voice Control (System Settings → Accessibility → Voice
Control), Windows Voice Access (Windows 11, Settings → Accessibility →
Speech), Android Voice Access (Play Store). Hebrew: Voice Control and Voice
Access recognise English commands; say the Hebrew label after the English
verb ("click שחזור"), or use "show names" / "show numbers" overlays.

| # | Action | Say (English UI) | Say (Hebrew UI) | Pass when |
|---|---|---|---|---|
| 1 | Open the command palette | "press Command K" / "press Control K" | same | the palette opens |
| 2 | Run a command from it | "type trash", "press Enter" | "type סל" | the trash opens |
| 3 | Restore a deleted note | "click Restore" | "click שחזור" | the note is back, focus stays in the dialog |
| 4 | Select two rows and restore them | "click Select a.md", "click Select b.md", "click Restore selected" | "click בחירת …", "click שחזור הנבחרים" | both are back |
| 5 | Close the dialog | "click Close" / "press Escape" | "click סגירה" | focus is back where it was |
| 6 | Move a document tab | "right click a.md", "click Move later" | "click הזזה למקום הבא" | the tab moved one place |
| 7 | Close a tab | "click Close tab" | "click סגור טאב" | the tab is gone |
| 8 | Toggle a setting | "click Show the other members which note I have open" (or "show numbers", "click 12") | "click להראות …" | the checkbox changes |
| 9 | Dismiss a notification | "click Dismiss" | "click סגור" | the notification goes |
| 10 | Resize the sidebar without dragging | "click Resize the sidebar" | "click שינוי רוחב סרגל הצד" | the sidebar takes the next width |

Record per platform and language: pass / fail and what was said. A control
that needed "show numbers" because its name did not match its text is a
2.5.3 finding: open an issue with the screenshot.
