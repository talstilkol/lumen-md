import { createContext } from "react";

/**
 * Identity of the document whose markdown the surrounding preview tree was
 * rendered from. The preview renders asynchronously, so while switching tabs
 * it briefly still shows the previous document's tree; blocks that keep
 * per-document state (live-js shared scopes) must use this — not the
 * store's *current* document — or the old blocks would run in the new
 * document's scope. null outside a document preview.
 */
export const PreviewDocKeyContext = createContext<string | null>(null);
