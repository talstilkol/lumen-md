/**
 * Unit tests for CRDT sync module.
 *
 * Run with: npx vitest run
 */

import { describe, it, expect } from "vitest";
import { CRDTManager, CRDTDoc } from "../storage/crdt";

describe("CRDT Operations", () => {
  it("creates an insert operation", () => {
    const mgr = new CRDTManager("peer-A");
    const op = mgr.createInsert(0, "Hello");
    expect(op.type).toBe("insert");
    expect(op.value).toBe("Hello");
    expect(op.position).toBe(0);
    expect(op.peerId).toBe("peer-A");
    expect(op.timestamp).toBeGreaterThan(0);
  });

  it("creates a delete operation", () => {
    const mgr = new CRDTManager("peer-A");
    const op = mgr.createDelete(0, 5);
    expect(op.type).toBe("delete");
    expect(op.position).toBe(0);
    expect(op.length).toBe(5);
  });

  it("applies insert to document", () => {
    const mgr = new CRDTManager("peer-A");
    const doc = mgr.newDoc("Hello");
    const op = mgr.createInsert(5, " World");
    const newDoc = mgr.apply(doc, op);
    expect(newDoc.content).toBe("Hello World");
  });

  it("applies delete to document", () => {
    const mgr = new CRDTManager("peer-A");
    const doc = mgr.newDoc("Hello World");
    const op = mgr.createDelete(5, 6);
    const newDoc = mgr.apply(doc, op);
    expect(newDoc.content).toBe("Hello");
  });

  it("merges concurrent inserts from two peers", () => {
    const mgrA = new CRDTManager("peer-A");
    const mgrB = new CRDTManager("peer-B");
    const docA = mgrA.newDoc("Hello");
    const docB = mgrB.newDoc("Hello");

    const opA = mgrA.createInsert(5, " Alice");
    const opB = mgrB.createInsert(5, " Bob");

    // Both peers apply their own op
    const docA2 = mgrA.apply(docA, opA);
    const docB2 = mgrB.apply(docB, opB);

    // Then merge the remote op
    const docA3 = mgrA.merge(docA2, [opB]);
    const docB3 = mgrB.merge(docB2, [opA]);

    // After merge, both should have the same content
    expect(docA3.content).toBe(docB3.content);
  });

  it("increments Lamport timestamp", () => {
    const mgr = new CRDTManager("peer-A");
    const op1 = mgr.createInsert(0, "a");
    const op2 = mgr.createInsert(1, "b");
    expect(op2.timestamp).toBeGreaterThan(op1.timestamp);
  });
});
