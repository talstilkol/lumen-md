/**
 * W11.Q10: the dedicated worker that owns OPFS note writes and batched reads
 * (sync access handles exist only here). The logic is ./vaultIoFs.ts; this file only
 * wires it to messages. Started by ./opfsSyncWrite.ts.
 */
import "../../ai/workerLedgerInstall"; // first: what this worker fetches reaches the privacy ledger (plan 2.4, W10.D22)
import { handleRead, handleWrite, opfsRootDir, type ReadRequest, type WriteRequest } from "./vaultIoFs";

const scope = self as unknown as { onmessage: ((e: MessageEvent<WriteRequest | ReadRequest>) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };
const root = opfsRootDir;
scope.onmessage = (e) => {
  const msg = e.data;
  // The #856 follow-up: reads come here too, a batch of files per message; their bytes travel back transferred, not copied.
  if (msg.op === "read") void handleRead(msg, root).then((a) => scope.postMessage(a, a.ok ? [a.data] : []));
  else void handleWrite(msg, root).then((answer) => scope.postMessage(answer));
};
