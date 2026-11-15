/**
 * W11.Q10: the dedicated worker that owns OPFS note writes (sync access
 * handles exist only here). The logic is ./vaultIoFs.ts; this file only
 * wires it to messages. Started by ./opfsSyncWrite.ts.
 */
import { handleWrite, type DirLike, type WriteRequest } from "./vaultIoFs";

const scope = self as unknown as { onmessage: ((e: MessageEvent<WriteRequest>) => void) | null; postMessage(m: unknown): void };
scope.onmessage = (e) => {
  void handleWrite(e.data, async () => (await navigator.storage.getDirectory()) as unknown as DirLike).then((answer) => scope.postMessage(answer));
};
