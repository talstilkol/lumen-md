/**
 * "End session" on the relay (plan W12.H3): ask the live-share server to
 * delete the study room, and ask whether it is still stored.
 *
 * Both go over the token socket (the app's CSP allows ws:/wss: to any host,
 * not https:). The request carries what each server checks before it
 * deletes anything: a room token for the room (the self-hosted Node server,
 * sync-server/collab-server.mjs) and the room proof that the committed name
 * commits to (the public Worker, edge-workers/collab/worker.mjs). Both come
 * from the room's password, so only a participant can delete the room.
 */
import { committedRoomName, roomProof } from "../collab/roomProof";
import { requestRoomToken } from "../collab/roomToken";
import { tokenRequest } from "../collab/sharing";

export interface RelayRoom {
  serverUrl: string;
  /** The plain room name (`havruta-…`). */
  room: string;
  password: string;
  accessKey?: string | null;
}

async function admin<T>(r: RelayRoom, action: "delete" | "exists"): Promise<T> {
  const serverRoom = await committedRoomName(r.room, r.password);
  const { token } = await requestRoomToken(r.serverUrl, serverRoom, r.accessKey ?? null, { password: r.password });
  const proof = await roomProof(r.password, r.room);
  return tokenRequest<T>(r.serverUrl, { action, room: serverRoom, token, proof, ...(r.accessKey ? { key: r.accessKey } : {}) });
}

/** Delete the room on the relay. Resolves with the server's answer ({deleted: true, status: 404}). */
export function deleteRoomOnRelay(r: RelayRoom): Promise<{ deleted?: boolean; status?: number; error?: string }> {
  return admin(r, "delete");
}

/** 200 while the relay stores the room, 404 once it is gone. */
export async function roomStatusOnRelay(r: RelayRoom): Promise<number> {
  const a = await admin<{ status?: number; error?: string }>(r, "exists");
  if (typeof a.status !== "number") throw new Error(a.error ?? "no status");
  return a.status;
}
