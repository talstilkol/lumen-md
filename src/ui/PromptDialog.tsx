import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { t } from "../i18n";

/**
 * Lightweight, themed replacement for native window.prompt / confirm / alert.
 *
 * Usage:
 *   const v = await uiPrompt({ message: "URL?", defaultValue: "https://" });
 *   const ok = await uiConfirm({ message: "Discard?" });
 *   await uiAlert({ message: "Saved." });
 *
 * The dialog is keyboard-friendly (Esc/Enter), focus-trapped to itself, and
 * restores focus to the previously-focused element on close.
 */

type Kind = "prompt" | "confirm" | "alert";

interface DialogOpts {
  message: string;
  defaultValue?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** When provided, the input is rendered with this placeholder. */
  placeholder?: string;
  title?: string;
}

interface InternalProps extends DialogOpts {
  kind: Kind;
  onResolve: (value: string | boolean | null) => void;
}

function PromptDialogImpl({
  kind,
  message,
  defaultValue = "",
  okLabel,
  cancelLabel,
  placeholder,
  title,
  onResolve,
}: InternalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const okRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    // Initial focus: input for prompt, OK for confirm/alert.
    setTimeout(() => {
      if (kind === "prompt") {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        okRef.current?.focus();
      }
    }, 0);
    return () => {
      const prev = previousFocusRef.current as HTMLElement | null;
      prev?.focus?.();
    };
  }, [kind]);

  // Focus trap inside the dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function submit() {
    if (kind === "prompt") onResolve(value);
    else if (kind === "confirm") onResolve(true);
    else onResolve(null);
  }

  function cancel() {
    if (kind === "prompt") onResolve(null);
    else if (kind === "confirm") onResolve(false);
    else onResolve(null);
  }

  return (
    <div
      className="prompt-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-dialog-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div className="prompt-dialog" ref={dialogRef}>
        <div id="prompt-dialog-title" className="prompt-title">
          {title ?? message}
        </div>
        {title && <div className="prompt-message">{message}</div>}
        {kind === "prompt" && (
          <input
            ref={inputRef}
            className="prompt-input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            spellCheck={false}
          />
        )}
        <div className="prompt-actions">
          {kind !== "alert" && (
            <button
              type="button"
              className="prompt-btn prompt-btn-cancel"
              onClick={cancel}
            >
              {cancelLabel ?? t("dialog.cancel")}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            className="prompt-btn prompt-btn-ok"
            onClick={submit}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
            }}
          >
            {okLabel ?? t("dialog.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}

function show<T>(kind: Kind, opts: DialogOpts): Promise<T> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const cleanup = () => {
      try {
        root.unmount();
      } catch {
        /* ignore */
      }
      host.remove();
    };
    root.render(
      <PromptDialogImpl
        kind={kind}
        {...opts}
        onResolve={(v) => {
          cleanup();
          resolve(v as T);
        }}
      />,
    );
  });
}

export function uiPrompt(opts: DialogOpts): Promise<string | null> {
  return show<string | null>("prompt", opts);
}
export function uiConfirm(opts: DialogOpts): Promise<boolean> {
  return show<boolean>("confirm", opts);
}
export function uiAlert(opts: DialogOpts): Promise<null> {
  return show<null>("alert", opts);
}
