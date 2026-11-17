/** Event names of typed objects (W12.T2/T3), without dependencies, so startup code can use them. */
/** Fired after a type file is written by the app (Object Studio, W12.T2). */
export const TYPES_CHANGED_EVENT = "lumen-types-changed";
/** Opens the page of a type: `detail: { type?: string }` (W12.T3). */
export const OPEN_TYPE_PAGE = "lumen-open-type-page";

export function openTypePage(type?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_TYPE_PAGE, { detail: { type } }));
}

/** Opens Object Studio (W12.T2); `detail: { newNote?: string }` starts a note of that type. */
export const OPEN_OBJECT_STUDIO = "lumen-open-object-studio";

export function openObjectStudio(newNote?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_OBJECT_STUDIO, { detail: { newNote } }));
}
