/**
 * Tests for the persistent room management with access control.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createRoomMeta,
  getRoomMeta,
  makeRoomId,
  createInvite,
  validateInvite,
  consumeInvite,
  isRoomOwner,
  listMyRooms,
  touchRoom,
  addPeer,
  pruneInvites,
} from "../collab/roomManager";

describe("roomManager", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.removeItem("lumen.collab.rooms");
  });

  describe("makeRoomId", () => {
    it("returns a deterministic id for the same name", () => {
      const id1 = makeRoomId("my-room");
      const id2 = makeRoomId("my-room");
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^r-[a-f0-9]{8}-myroom$/);
    });

    it("produces different ids for different names", () => {
      const id1 = makeRoomId("room-a");
      const id2 = makeRoomId("room-b");
      expect(id1).not.toBe(id2);
    });
  });

  describe("createRoomMeta", () => {
    it("creates a room with the given name and owner", () => {
      const room = createRoomMeta("Test Room", "client-123");
      expect(room.roomName).toBe("Test Room");
      expect(room.ownerClientId).toBe("client-123");
      expect(room.peers).toEqual([]);
      expect(room.createdAt).toBeGreaterThan(0);
      expect(room.lastActivity).toBeGreaterThan(0);
    });

    it("returns existing room without overwriting", () => {
      createRoomMeta("Dup Room", "owner-1");
      const second = createRoomMeta("Dup Room", "owner-2");
      expect(second.ownerClientId).toBe("owner-1");
    });
  });

  describe("getRoomMeta", () => {
    it("returns null for unknown room", () => {
      expect(getRoomMeta("r-unknown")).toBeNull();
    });

    it("returns the room after creation", () => {
      const room = createRoomMeta("Find Me", "owner");
      expect(getRoomMeta(room.roomId)).toEqual(room);
    });
  });

  describe("addPeer", () => {
    it("adds a peer to the room", () => {
      const room = createRoomMeta("Peers", "owner");
      addPeer(room.roomId, "peer-1");
      const updated = getRoomMeta(room.roomId);
      expect(updated?.peers).toContain("peer-1");
    });

    it("does not duplicate peers", () => {
      const room = createRoomMeta("Peers", "owner");
      addPeer(room.roomId, "peer-1");
      addPeer(room.roomId, "peer-1");
      expect(getRoomMeta(room.roomId)?.peers).toEqual(["peer-1"]);
    });
  });

  describe("isRoomOwner", () => {
    it("returns true for the owner client id", () => {
      const room = createRoomMeta("Owned", "me");
      expect(isRoomOwner(room.roomId, "me")).toBe(true);
    });

    it("returns false for other client ids", () => {
      const room = createRoomMeta("Owned", "me");
      expect(isRoomOwner(room.roomId, "not-me")).toBe(false);
    });
  });

  describe("createInvite / validateInvite / consumeInvite", () => {
    it("creates a valid invite token", () => {
      const room = createRoomMeta("Invites", "owner");
      const fragment = createInvite(room.roomId, 1); // 1 hour TTL
      expect(fragment).toContain("invite=");

      const token = new URLSearchParams(fragment).get("invite");
      expect(token).toBeTruthy();
      expect(validateInvite(room.roomId, token!)).toBe(true);
    });

    it("rejects invalid tokens", () => {
      const room = createRoomMeta("Invites", "owner");
      expect(validateInvite(room.roomId, "bogus")).toBe(false);
    });

    it("marks invite as consumed", () => {
      const room = createRoomMeta("Invites", "owner");
      const fragment = createInvite(room.roomId, 24);
      const token = new URLSearchParams(fragment).get("invite")!;

      expect(consumeInvite(room.roomId, token, "joiner")).toBe(true);
      expect(consumeInvite(room.roomId, token, "joiner-2")).toBe(true); // still valid
    });
  });

  describe("listMyRooms", () => {
    it("returns rooms sorted by lastActivity desc", () => {
      createRoomMeta("Older", "o");
      const r2 = createRoomMeta("Newer", "o");
      // touch r2 to make it newer
      touchRoom(r2.roomId);
      const rooms = listMyRooms();
      expect(rooms[0].roomName).toBe("Newer");
    });
  });

  describe("pruneInvites", () => {
    it("removes expired invites", () => {
      const room = createRoomMeta("Prune", "o");
      createInvite(room.roomId, 0); // 0 hours = already expired
      expect(getRoomMeta(room.roomId)?.invites?.length).toBe(1);

      pruneInvites();
      expect(getRoomMeta(room.roomId)?.invites).toEqual([]);
    });
  });
});
