/**
 * Unit tests for CRDT sync module.
 *
 * Run with: npx vitest run
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  initCRDT,
  createInsert,
  createDelete,
  createSet,
  mergeOperations,
  resolveDocument,
  getPendingOps,
  markSynced,
  getCRDTStats,
} from "../storage/crdt";

describe("CRDT Operations", () => {
  beforeEach(async () => {
    // Initialize CRDT before each test
    await initCRDT();
  });

  it("creates an insert operation", () => {
    const op = createInsert("test.md", 0, "Hello");
    expect(op.type).toBe("insert");
    expect(op.content).toBe("Hello");
    expect(op.position).toBe(0);
    expect(op.peerId).toBeTruthy();
    expect(op.timestamp).toBeGreaterThan(0);
  });

  it("creates a delete operation", () => {
    const op = createDelete("test.md", 0, 5);
    expect(op.type).toBe("delete");
    expect(op.position).toBe(0);
    expect(op.length).toBe(5);
  });

  it("creates a set operation", () => {
    const op = createSet("test.md", "Hello World");
    expect(op.type).toBe("set");
    expect(op.value).toBe("Hello World");
  });

  it("resolves document after insert", () => {
    createSet("doc.md", "Hello");
    createInsert("doc.md", 5, " World");
    const result = resolveDocument("doc.md");
    expect(result).toBe("Hello World");
  });

  it("resolves document after delete", () => {
    createSet("doc.md", "Hello World");
    createDelete("doc.md", 5, 6);
    const result = resolveDocument("doc.md");
    expect(result).toBe("Hello");
  });

  it("tracks pending operations", () => {
    createInsert("test.md", 0, "test");
    const pending = getPendingOps();
    expect(pending.length).toBeGreaterThan(0);
  });

  it("marks operations as synced", () => {
    const op = createInsert("test.md", 0, "test");
    const pendingBefore = getPendingOps().length;
    markSynced([op.id]);
    const pendingAfter = getPendingOps().length;
    expect(pendingAfter).toBeLessThan(pendingBefore);
  });

  it("returns CRDT stats", () => {
    createInsert("test.md", 0, "test");
    const stats = getCRDTStats();
    expect(stats).not.toBeNull();
    expect(stats!.peerId).toBeTruthy();
    expect(stats!.totalOps).toBeGreaterThan(0);
    expect(stats!.lamportClock).toBeGreaterThan(0);
  });

  it("increments Lamport timestamp", () => {
    const op1 = createInsert("test.md", 0, "a");
    const op2 = createInsert("test.md", 1, "b");
    expect(op2.timestamp).toBeGreaterThan(op1.timestamp);
  });
});
