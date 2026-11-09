/**
 * Which canvas engine the app runs (plan 4.19).
 *
 * `false` while the canvas is still `CanvasTldraw.tsx`: the
 * "convert tldraw canvases to Excalidraw" palette command is not offered,
 * because nothing could open the converted files yet.
 *
 * The PR that swaps in the Excalidraw component (after
 * `@excalidraw/excalidraw` is in package-lock.json) sets this to `true`.
 * Being a constant, the bundler drops the command entry while it is `false`.
 */
export const EXCALIDRAW_CANVAS_ENABLED: boolean = false;
