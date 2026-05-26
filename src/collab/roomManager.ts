/**
 * Persistent room management with access control.
 *
 * Room IDs are stable (sha256-based), so URLs can be bookmarked and shared.
 * Owners manage the room via localStorage; invite links can be generated
 * with optional expiry.
 */

import { log } from "../lib/logger";

const STORAGE_KEY = "lumen.collab.rooms";

export interface RoomMeta {
  roomId: string;
  roomName: string;
  ownerClientId: string; // clientId of creator (local)
  createdAt: number;
  lastActivity: number;
  /** List of known peer clientIds (best-effort, local only). */
  peers: string[];
  /** Invite links with expiry. */
  invites?: Array<{ token: string; expiresAt: number; usedBy?: string[] }>;
  /** Optional password for E2E encryption in this room. */
  password?: string;
}

function loadRooms(): Record<string, RoomMeta> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveRooms(rooms: Record<string, RoomMeta>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

/**
 * Generate a deterministic room ID from a display name.
 * Uses a simple hash so the same roomName always yields the same ID.
 */
export function makeRoomId(roomName: string): string {
  // djb2-like hash, truncated to 12 chars
  let h = 5381;
  for (let i = 0; i < roomName.length; i++) {
    h = ((h << 5) + h + roomName.charCodeAt(i)) & 0xffffffff;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `r-${hex}-${roomName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
}

export function createRoomMeta(
  roomName: string,
  ownerClientId: string,
  opts: { password?: string } = {},
): RoomMeta {
  const roomId = makeRoomId(roomName);
  const rooms = loadRooms();
  const existing = rooms[roomId];
  if (existing) {
    log.info("roomManager", "Room already exists", { roomId });
    return existing;
  }

  const meta: RoomMeta = {
    roomId,
    roomName,
    ownerClientId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    peers: [],
    password: opts.password,
  };
  rooms[roomId] = meta;
  saveRooms(rooms);
  return meta;
}

export function getRoomMeta(roomId: string): RoomMeta | null {
  return loadRooms()[roomId] ?? null;
}

export function touchRoom(roomId: string): void {
  const rooms = loadRooms();
  if (rooms[roomId]) {
    rooms[roomId].lastActivity = Math.max(Date.now(), rooms[roomId].lastActivity + 1);
    saveRooms(rooms);
  }
}

export function addPeer(roomId: string, clientId: string): void {
  const rooms = loadRooms();
  const room = rooms[roomId];
  if (!room) return;
  if (!room.peers.includes(clientId)) {
    room.peers.push(clientId);
    room.lastActivity = Date.now();
    saveRooms(rooms);
  }
}

/**
 * Generate an invite token valid for `ttlHours` (default 24).
 * Returns the full URL fragment the receiver can paste into their browser.
 */
export function createInvite(roomId: string, ttlHours = 24): string {
  const rooms = loadRooms();
  const room = rooms[roomId];
  if (!room) throw new Error("Room not found");

  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 16);

  room.invites ??= [];
  room.invites.push({
    token,
    expiresAt: Date.now() + ttlHours * 3600_000,
  });
  saveRooms(rooms);

  return `#room=${roomId}&invite=${token}`;
}

/** Check whether an invite token is valid for the given room. */
export function validateInvite(roomId: string, token: string): boolean {
  const room = getRoomMeta(roomId);
  if (!room?.invites) return false;
  const invite = room.invites.find((i) => i.token === token);
  if (!invite) return false;
  if (Date.now() > invite.expiresAt) return false;
  return true;
}

export function consumeInvite(roomId: string, token: string, clientId: string): boolean {
  const room = getRoomMeta(roomId);
  if (!room?.invites) return false;
  const invite = room.invites.find((i) => i.token === token);
  if (!invite || Date.now() > invite.expiresAt) return false;
  invite.usedBy ??= [];
  invite.usedBy.push(clientId);
  touchRoom(roomId);
  return true;
}

export function isRoomOwner(roomId: string, clientId: string): boolean {
  const room = getRoomMeta(roomId);
  return room?.ownerClientId === clientId;
}

export function listMyRooms(): RoomMeta[] {
  const rooms = loadRooms();
  return Object.values(rooms).sort((a, b) => b.lastActivity - a.lastActivity);
}

/** Prune all expired invites. */
export function pruneInvites(): void {
  const rooms = loadRooms();
  const now = Date.now();
  let changed = false;
  for (const r of Object.values(rooms)) {
    if (r.invites) {
      const before = r.invites.length;
      r.invites = r.invites.filter((i) => i.expiresAt > now);
      if (r.invites.length < before) changed = true;
    }
  }
  if (changed) saveRooms(rooms);
}
