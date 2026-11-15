/**
 * Plan 10.1 / W10.E8: the `lumen/modal-only` ESLint rule — `aria-modal`
 * only in src/ui/Modal.tsx; every other modal dialog is <Modal>.
 * @vitest-environment node
 */
import { describe, it } from "vitest";
import { RuleTester } from "eslint";
// @ts-expect-error -- plain JS rule module, no types
import rule from "../../eslint-rules/modal-only.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run("lumen/modal-only", rule, {
  valid: [
    { code: '<Modal aria-label="Settings" onClose={close}><button /></Modal>', filename: "src/ui/SettingsScreen.tsx" },
    { code: '<dialog role="dialog" aria-modal="true" />', filename: "src/ui/Modal.tsx" },
    { code: "el.closest('[aria-modal=\"true\"]');", filename: "src/ui/useFocusTrap.ts" },
    { code: '<div role="dialog" aria-label="A non-modal popover" />', filename: "src/ui/Popover.tsx" },
  ],
  invalid: [
    { code: '<div role="dialog" aria-modal="true" aria-label="x" />', filename: "src/ui/Bad.tsx", errors: [{ messageId: "useModal" }] },
    { code: "<div aria-modal />", filename: "src/ui/Bare.tsx", errors: [{ messageId: "useModal" }] },
    { code: '<div aria-modal={open ? "true" : undefined} />', filename: "src/ui/Cond.tsx", errors: [{ messageId: "useModal" }] },
    { code: 'const p = { "aria-modal": "true" };', filename: "src/ui/Spread.tsx", errors: [{ messageId: "useModal" }] },
    { code: 'el.setAttribute("aria-modal", "true");', filename: "src/ui/Dom.ts", errors: [{ messageId: "useModal" }] },
  ],
});
