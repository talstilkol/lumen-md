/**
 * Ambient declaration for `y-websocket` — an OPTIONAL runtime dependency
 * that is intentionally NOT listed in package.json. The collab layer
 * loads it via a dynamic `await import("y-websocket")` so a bundle
 * without the package still ships and falls back to WebRTC.
 *
 * Without this file, `npm run typecheck` fails on a clean install
 * (CI never has the package installed) — which was the long-running
 * red X on every main-branch run.
 *
 * The shape matches what `src/collab/yjs.ts` actually consumes — anything
 * else can stay `unknown` because the call site already casts.
 */

declare module "y-websocket" {
  import type * as Y from "yjs";

  export class WebsocketProvider {
    constructor(
      serverUrl: string,
      roomName: string,
      doc: Y.Doc,
      opts?: {
        connect?: boolean;
        awareness?: unknown;
        params?: Record<string, string>;
        WebSocketPolyfill?: unknown;
        resyncInterval?: number;
        maxBackoffTime?: number;
        disableBc?: boolean;
      },
    );
    wsconnected: boolean;
    wsconnecting: boolean;
    connect(): void;
    disconnect(): void;
    destroy(): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
  }
}
