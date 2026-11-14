/**
 * Automatic alt text for pasted images (T31); `lumen.ai.imageText` = "off"
 * disables it. Moved as is from Editor.tsx, which is at its max-lines
 * baseline (W6.25).
 */
export function imageTextEnabled(): boolean {
  try {
    return localStorage.getItem("lumen.ai.imageText") !== "off";
  } catch {
    return true;
  }
}
