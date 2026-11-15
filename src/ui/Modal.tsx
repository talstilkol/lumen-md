/**
 * The one modal dialog primitive (plan 10.1, W10.E5–E8).
 *
 * Every modal dialog of the app is a native `<dialog>` opened with
 * `showModal()`: the browser puts it in the top layer and makes the rest
 * of the page inert (no click, no focus, hidden from screen readers —
 * which a `<div aria-modal>` only promised). On top of that:
 *  - Tab and Shift+Tab stay inside, Escape calls `onClose`, and focus
 *    returns to the element that opened it (./useFocusTrap.ts);
 *  - `closedby` says which close requests the browser may honour: Escape
 *    and the Android back gesture (`closerequest`, the default), also a
 *    click outside (`any`), or none (`none`, a dialog that must not be
 *    dismissed while it works). The browser never closes it itself: a
 *    close request calls `onClose`, and the dialog closes when React
 *    removes it.
 *
 * `aria-modal` appears only here: src/__tests__/modalTraps.test.ts and the
 * `lumen/modal-only` ESLint rule fail on any other element that sets it.
 *
 * Where `showModal` does not exist (jsdom in unit tests, very old
 * browsers) the dialog is opened with the `open` attribute and the focus
 * trap does the rest.
 */
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type ForwardedRef, type HTMLAttributes, type ReactNode } from "react";
import { useFocusTrap } from "./useFocusTrap";

type Labelled = { "aria-label": string; "aria-labelledby"?: undefined } | { "aria-labelledby": string; "aria-label"?: undefined };

export type ModalProps = Labelled &
  Omit<HTMLAttributes<HTMLDialogElement>, "role" | "aria-modal" | "aria-label" | "aria-labelledby" | "open" | "children"> & {
    /** Escape or another close request (the back gesture). Without it, nothing dismisses the dialog that way. */
    onClose?: () => void;
    /** Which close requests count: `closerequest` (default with `onClose`), `any` (a click outside too), `none` (default without `onClose`). */
    closedBy?: "any" | "closerequest" | "none";
    /** Rendered inside another surface (a tab of the settings screen): a plain region, not a modal. */
    embedded?: boolean;
    /** Give focus back to what had it before the dialog opened (default true). */
    restoreFocus?: boolean;
    children?: ReactNode;
  };

export const Modal = forwardRef(function Modal(
  { onClose, closedBy, embedded = false, restoreFocus = true, children, className, ...rest }: ModalProps,
  forwarded: ForwardedRef<HTMLElement>,
) {
  const ref = useRef<HTMLDialogElement | null>(null);
  // The component's own ref (a reader that scrolls or focuses its root) sees the same element.
  const setRef = useCallback(
    (el: HTMLDialogElement | HTMLDivElement | null) => {
      ref.current = el instanceof HTMLDivElement ? null : el;
      if (typeof forwarded === "function") forwarded(el);
      else if (forwarded) forwarded.current = el;
    },
    [forwarded],
  );
  const close = useRef(onClose);
  close.current = onClose;
  const by = closedBy ?? (onClose ? "closerequest" : "none");

  // Open as a modal before the first paint, close when React removes it.
  useLayoutEffect(() => {
    const d = ref.current;
    if (embedded || !d) return;
    const open = () => {
      if (!d.isConnected) return;
      if (typeof d.showModal === "function") {
        try {
          if (!d.open) d.showModal();
        } catch {
          // why: not connected yet, or already open without being modal: open it plainly, the trap still holds focus
          d.setAttribute("open", "");
        }
      } else d.setAttribute("open", "");
    };
    // T6-L8: a dialog mounted inside another in one render runs this before its
    // parent does; it opens after the parent (still before paint), so the top
    // layer puts it above the dialog that contains it.
    const outer = d.parentElement?.closest("dialog");
    if (outer && !outer.open) queueMicrotask(open);
    else open();
    return () => {
      if (typeof d.close === "function" && d.open) d.close();
      else d.removeAttribute("open");
    };
  }, [embedded]);

  // `closedby` (not in React's attribute list) and the close requests.
  useEffect(() => {
    const d = ref.current;
    if (embedded || !d) return;
    d.setAttribute("closedby", by);
    const onCancel = (e: Event) => {
      // The browser would close the dialog behind React's back: React closes it.
      e.preventDefault();
      if (by !== "none") close.current?.();
    };
    // `closedby="any"`: a click on the dialog itself (its backdrop area), not on its content, closes — in every engine.
    const onClick = (e: MouseEvent) => {
      if (by === "any" && e.target === d) close.current?.();
    };
    d.addEventListener("cancel", onCancel);
    d.addEventListener("click", onClick);
    return () => {
      d.removeEventListener("cancel", onCancel);
      d.removeEventListener("click", onClick);
    };
  }, [by, embedded]);

  useFocusTrap(ref, { active: !embedded, onEscape: by === "none" ? undefined : () => close.current?.(), restoreFocus });

  if (embedded) {
    const { "aria-label": label, "aria-labelledby": labelledBy, ...divProps } = rest;
    return (
      <div ref={setRef} role="region" aria-label={label} aria-labelledby={labelledBy} className={className} {...(divProps as HTMLAttributes<HTMLDivElement>)}>
        {children}
      </div>
    );
  }
  return (
    // The explicit role is the implicit one: it keeps `[role="dialog"]` queries (tests, the e2e helpers) working.
    // eslint-disable-next-line jsx-a11y/no-redundant-roles
    <dialog ref={setRef} role="dialog" aria-modal="true" className={className ? `lumen-modal ${className}` : "lumen-modal"} {...rest}>
      {children}
    </dialog>
  );
});
