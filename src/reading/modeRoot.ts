/**
 * A reading mode's root marker (plan W13.R13): `data-reading-mode="<id>"`
 * on the element the mode draws in. JSX writes the attribute itself (or
 * spreads `modeRoot(id, on)` when the mode is a state of a shared element);
 * a mode that builds its DOM by hand sets it with `setModeRoot`. The unit
 * gate (src/__tests__/readingModesGate.test.ts) finds every id written in
 * any of these three forms and fails on one that src/reading/modes.ts does
 * not register.
 */
export const MODE_ATTR = "data-reading-mode";

/** The marker as JSX props, spread on the root (nothing when `on` is false). */
export function modeRoot(id: string, on = true): Record<string, string> {
  return on ? { [MODE_ATTR]: id } : {};
}

/** Mark `el` as the mode's root; `clearModeRoot` takes it off again (only if it is still this mode's). */
export function setModeRoot(el: HTMLElement, id: string): void {
  el.setAttribute(MODE_ATTR, id);
}

export function clearModeRoot(el: HTMLElement, id: string): void {
  if (el.getAttribute(MODE_ATTR) === id) el.removeAttribute(MODE_ATTR);
}
