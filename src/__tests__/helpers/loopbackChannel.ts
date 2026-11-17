/**
 * A LanChannel over a real TCP socket on 127.0.0.1 (plan W2.19, W10.E44): the
 * loopback harness's transport. The app's link is an RTCDataChannel (lan/link.ts),
 * which is reliable, ordered and message-framed. TCP is reliable and ordered, so
 * each message is framed here as [u32 length][bytes], and the frames really
 * cross the kernel's network stack: syscalls, socket buffers, Nagle (off, as a
 * data channel sends at once) and partial reads.
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import type { LanChannel } from "../../sync/e2ee/lan/channel";

function socketChannel(socket: Socket, onFrame?: (data: Uint8Array) => void): LanChannel {
  const msg = new Set<(d: Uint8Array) => void>();
  const close = new Set<() => void>();
  let closed = false;
  let buf: Buffer = Buffer.alloc(0);
  socket.setNoDelay(true);
  socket.on("data", (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 4) {
      const n = buf.readUInt32BE(0);
      if (buf.length < 4 + n) break;
      const frame = new Uint8Array(buf.subarray(4, 4 + n));
      buf = buf.subarray(4 + n);
      for (const fn of [...msg]) fn(frame);
    }
  });
  const shut = () => {
    if (closed) return;
    closed = true;
    for (const fn of [...close]) fn();
  };
  socket.on("close", shut);
  socket.on("error", shut);
  return {
    get closed() {
      return closed;
    },
    send(data) {
      if (closed) return;
      onFrame?.(data);
      const head = Buffer.alloc(4);
      head.writeUInt32BE(data.byteLength, 0);
      socket.write(Buffer.concat([head, Buffer.from(data.buffer, data.byteOffset, data.byteLength)]));
    },
    onMessage(fn) {
      msg.add(fn);
      return () => msg.delete(fn);
    },
    onClose(fn) {
      close.add(fn);
      return () => close.delete(fn);
    },
    close() {
      socket.end();
      socket.destroy();
      shut();
    },
  };
}

export interface LoopbackPair {
  host: LanChannel;
  peer: LanChannel;
  /** The address the peer connected to (127.0.0.1:<ephemeral port>). */
  address: string;
  /** Every frame either side sent, for a check that no plaintext crossed the wire. */
  frames: Uint8Array[];
  shutdown(): Promise<void>;
}

/** Listen on 127.0.0.1, connect to it, and give both ends as LanChannels. */
export async function loopbackPair(): Promise<LoopbackPair> {
  const frames: Uint8Array[] = [];
  let server: Server | null = null;
  const accepted = new Promise<Socket>((resolve, reject) => {
    server = createServer((s) => resolve(s));
    server.on("error", reject);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server!.address() as { port: number };
  const client = connect({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("error", reject);
  });
  const hostSocket = await accepted;
  const host = socketChannel(hostSocket, (d) => frames.push(d.slice()));
  const peer = socketChannel(client, (d) => frames.push(d.slice()));
  return {
    host,
    peer,
    address: `127.0.0.1:${port}`,
    frames,
    async shutdown() {
      host.close();
      peer.close();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    },
  };
}
