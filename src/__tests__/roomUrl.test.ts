import { describe, it, expect, afterEach } from "vitest";
import { readRoomFromHash, setRoomInHash } from "../collab/roomUrl";

afterEach(() => history.replaceState(null, "", "/"));

describe("setRoomInHash", () => {
  it("keeps the room password from a #room=…&password=… join link", () => {
    history.replaceState(null, "", "/#room=old-room&password=s3cr%26t");
    setRoomInHash("blue-otter-42");
    expect(location.hash).toBe("#room=blue-otter-42&password=s3cr%26t");
    expect(readRoomFromHash()).toBe("blue-otter-42");
  });

  it("writes just the room when there is no password, and clears both on stop", () => {
    setRoomInHash("red-fox-1");
    expect(location.hash).toBe("#room=red-fox-1");
    history.replaceState(null, "", "/#room=red-fox-1&password=x");
    setRoomInHash(null);
    expect(location.hash).toBe("");
  });
});
