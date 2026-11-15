import { useState } from "react";

/**
 * True from the first time `open` is true, and from then on (W10.E19, 8.2):
 * a lazy dialog or panel is mounted on first open, not at startup, and stays
 * mounted after it closes, so its state (a query, a tab, a conversation)
 * survives.
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  // Updating state while rendering is React's pattern for state derived from a prop.
  if (open && !opened) setOpened(true);
  return opened || open;
}
