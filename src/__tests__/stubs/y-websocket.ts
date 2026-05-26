/**
 * Test-only stub for the optional `y-websocket` runtime dependency.
 *
 * `y-websocket` is intentionally NOT in package.json — production users
 * install it explicitly if they want persistent collab; otherwise the
 * dynamic `await import("y-websocket")` in src/collab/yjs.ts fails and
 * the session falls back to WebRTC-only.
 *
 * Vitest's import analyzer runs *before* `vi.mock(...)` overrides take
 * effect, which means the static-string `import("y-websocket")` call
 * fails to resolve in CI (no package installed). This stub gives the
 * analyzer something to resolve; the test file's own `vi.mock` then
 * replaces it with a controllable double.
 */

export class WebsocketProvider {
  static instances: unknown[] = [];
  constructor(
    _serverUrl: string,
    _roomName: string,
    _doc: unknown,
    _opts?: Record<string, unknown>,
  ) {
    WebsocketProvider.instances.push(this);
  }
  wsconnected = false;
  wsconnecting = false;
  connect(): void {}
  disconnect(): void {}
  destroy(): void {}
  on(_event: string, _handler: (...args: unknown[]) => void): void {}
  off(_event: string, _handler: (...args: unknown[]) => void): void {}
}
