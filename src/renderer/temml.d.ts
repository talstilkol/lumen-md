/** Plan W1.3 (W10.E77): Temml's API as the seam uses it (./temmlCore.ts). It is null when the package is missing (vite.config.ts aliases a stub). */
declare module "temml" {
  const temml: import("./temmlCore").TemmlLike | null;
  export default temml;
}
