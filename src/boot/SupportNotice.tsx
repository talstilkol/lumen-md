/**
 * "Your browser is outside support" (plan W13.T2): once per app version,
 * dismissible, with the policy and what still works. Lazy: only a browser
 * that fails supportCheck loads it.
 */
import { useEffect, useId, useRef, useState } from "react";
import { t } from "../i18n";
import "./supportNoticeStrings";
import { SUPPORT_NOTICE_KEY } from "./supportCheck";

export const POLICY_URL = "https://github.com/talstilkol/lumen-md/blob/main/docs/support-policy.md";
const POLICY_URL_HE = "https://github.com/talstilkol/lumen-md/blob/main/docs/support-policy.he.md";

export function SupportNotice({ missing, version, lang }: { missing: string[]; version: string; lang?: string }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  useEffect(() => {
    before.current = document.activeElement;
  }, []);
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(SUPPORT_NOTICE_KEY, version);
    } catch {
      // why: storage blocked: the notice comes back next start, which is all that is lost
    }
    setOpen(false);
    // why: focus goes back where it was, or to the editor — never to <body>
    const back = before.current instanceof HTMLElement && before.current !== document.body ? before.current : [".cm-content", "main", "#root"].map((q) => document.querySelector<HTMLElement>(q)).find(Boolean);
    if (back && !back.hasAttribute("tabindex") && !back.isContentEditable && !(back instanceof HTMLButtonElement)) back.setAttribute("tabindex", "-1");
    // why: after the notice unmounts (the button that had focus is gone)
    requestAnimationFrame(() => back?.focus());
  };
  const he = (lang ?? document.documentElement.lang) === "he";
  return (
    <section className="vault-folder-banner" role="region" aria-labelledby={id} data-testid="support-notice" style={{ insetBlockStart: "auto", insetBlockEnd: 12, maxInlineSize: "min(620px, calc(100vw - 24px))" }}>
      <p style={{ margin: 0 }}>
        <strong id={id}>{t("supportNotice.title")}</strong> {t("supportNotice.body")}{" "}
        <a href={he ? POLICY_URL_HE : POLICY_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
          {t("supportNotice.policy")}
        </a>
      </p>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>
        {/* why: API names are left-to-right; an isolate keeps them whole inside a Hebrew sentence */}
        {t("supportNotice.missing", { list: `\u2066${missing.join(", ")}\u2069` })}
      </p>
      <button ref={btn} type="button" className="vault-folder-btn" onClick={close}>
        {t("supportNotice.ok")}
      </button>
    </section>
  );
}
