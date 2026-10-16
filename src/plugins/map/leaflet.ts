/** Lazy, self-hosted Leaflet (JS + CSS + marker images), loaded once. */
let leafletPromise: Promise<typeof import("leaflet")> | null = null;
export async function getLeaflet() {
  if (!leafletPromise) {
    // Self-hosted Leaflet CSS: the side-effect import is code-split with
    // the leaflet chunk, so it ships from our origin (no unpkg / CSP hole)
    // and only loads when a map block first enters the viewport.
    leafletPromise = Promise.all([
      import("leaflet"),
      import("leaflet/dist/leaflet.css"),
      import("leaflet/dist/images/marker-icon.png?url"),
      import("leaflet/dist/images/marker-icon-2x.png?url"),
      import("leaflet/dist/images/marker-shadow.png?url"),
    ]).then(([mod, , icon, icon2x, shadow]) => {
      const L = (mod as { default?: typeof import("leaflet") }).default ?? mod;
      // Bundling the CSS fingerprints Leaflet's image URLs, which breaks its
      // CSS-path-based default-icon detection — point it at the bundled
      // marker images explicitly.
      L.Icon.Default.mergeOptions({
        imagePath: "", // Icon.Default prefixes this to the URLs below
        iconUrl: icon.default,
        iconRetinaUrl: icon2x.default,
        shadowUrl: shadow.default,
      });
      return mod;
    });
  }
  return leafletPromise;
}
