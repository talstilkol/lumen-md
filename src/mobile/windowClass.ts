/**
 * Window size classes (plan W13.M1), as Android 16 and Material 3 define
 * them: compact < 600 dp, medium 600–839 dp, expanded ≥ 840 dp (a CSS px in
 * the WebView is a dp). From API 36 Android ignores orientation and aspect
 * locks at ≥ 600 dp, so the app must lay itself out by width, never by
 * "phone or tablet":
 *
 *   - in the iOS / Android app the phone layout (sheets instead of side
 *     panels) ends at 600 dp, so a tablet in portrait or an unfolded
 *     foldable gets two columns;
 *   - in a browser and the desktop app the long-standing 760 px stays
 *     (narrow desktop windows keep their layout).
 *
 * <html data-window-class="compact|medium|expanded"> and, on a foldable
 * whose hinge splits the screen, data-window-segments="2" let CSS place a
 * pane on each side. Startup path: tiny, no imports.
 */

export type WindowClass = "compact" | "medium" | "expanded";

export function windowClassOf(widthDp: number): WindowClass {
  return widthDp < 600 ? "compact" : widthDp < 840 ? "medium" : "expanded";
}

/** Running inside the Capacitor app (iOS or Android)? */
export function isNativeShell(w: unknown = typeof window === "undefined" ? undefined : window): boolean {
  return !!(w as { Capacitor?: { isNativePlatform?: () => boolean } } | undefined)?.Capacitor?.isNativePlatform?.();
}

/** The media query of the phone layout: below 600 dp in the app, up to 760 px elsewhere. */
export function narrowQuery(native: boolean = isNativeShell()): string {
  return native ? "(max-width: 599.98px)" : "(max-width: 760px)";
}

/** Keep <html data-window-class> (and data-window-segments) current. Returns a stop function. */
export function trackWindowClass(win: Window = window): () => void {
  const root = win.document.documentElement;
  const apply = () => {
    root.dataset.windowClass = windowClassOf(win.innerWidth);
    const segs = (win as unknown as { viewport?: { segments?: unknown[] } }).viewport?.segments;
    if (Array.isArray(segs) && segs.length > 1) root.dataset.windowSegments = String(segs.length);
    else delete root.dataset.windowSegments;
  };
  apply();
  win.addEventListener("resize", apply);
  return () => win.removeEventListener("resize", apply);
}
