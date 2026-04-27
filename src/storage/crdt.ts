/**
 * CRDT Sync Foundation — Conflict-free Replicated Data Types for collaborative editing.
 * 
 * Implements a simple Last-Writer-Wins Register (LWW-Register) and
 * a sequence CRDT for text operations. This module provides the foundation
 * for real-time sync across devices.
 * 
 * Architecture:
 * - Each edit operation is a CRDT operation with a unique lamport timestamp
 * - Operations are stored in IndexedDB and synced via WebRTC or server
 * - Merge is commutative, associative, and idempotent
 */

import { get, set } from "idb-keyval";
import { randomId } from "../lib/cryptoRandom";

// ── Types ───────────────────────────────────────────────────────────────

export interface CRDTOperation {
  id: string;           // Unique operation ID
  type: "insert" | "delete" | "set";
  path: string;         // File path
  position: number;     // Character position for insert/delete
  content?: string;     // For insert operations
  length?: number;      // For delete operations
  value?: string;       // For set (full replacement)
  timestamp: number;    // Lamport timestamp
  peerId: string;       // ID of the peer that made this edit
  vectorClock: Record<string, number>;  // Vector clock for ordering
}

export interface CRDTState {
  peerId: string;
  lamportClock: number;
  vectorClock: Record<string, number>;
  operations: CRDTOperation[];
  pendingSync: CRDTOperation[];  // Operations not yet synced
}

// ── CRDT Manager ────────────────────────────────────────────────────────

const IDB_KEY = "lumen-crdt-state";
let state: CRDTState | null = null;

/** Lazily ensure CRDT state exists (synchronous fallback). */
function ensureState(): CRDTState {
  if (!state) {
    state = {
      peerId: generatePeerId(),
      lamportClock: 0,
      vectorClock: {},
      operations: [],
      pendingSync: [],
    };
  }
  return state;
}

/** Initialize the CRDT state */
export async function initCRDT(): Promise<CRDTState> {
  const saved = await get(IDB_KEY).catch(() => null);
  if (saved && saved.peerId) {
    state = saved as CRDTState;
  } else {
    state = {
      peerId: generatePeerId(),
      lamportClock: 0,
      vectorClock: {},
      operations: [],
      pendingSync: [],
    };
    await saveCRDTState();
  }
  return state;
}

/** Create a new insert operation */
export function createInsert(
  path: string,
  position: number,
  content: string,
): CRDTOperation {
  const s = ensureState();

  s.lamportClock++;
  s.vectorClock[s.peerId] = s.lamportClock;

  const op: CRDTOperation = {
    id: `${s.peerId}-${s.lamportClock}`,
    type: "insert",
    path,
    position,
    content,
    timestamp: s.lamportClock,
    peerId: s.peerId,
    vectorClock: { ...s.vectorClock },
  };

  s.operations.push(op);
  s.pendingSync.push(op);
  saveCRDTState();
  return op;
}

/** Create a new delete operation */
export function createDelete(
  path: string,
  position: number,
  length: number,
): CRDTOperation {
  const s = ensureState();

  s.lamportClock++;
  s.vectorClock[s.peerId] = s.lamportClock;

  const op: CRDTOperation = {
    id: `${s.peerId}-${s.lamportClock}`,
    type: "delete",
    path,
    position,
    length,
    timestamp: s.lamportClock,
    peerId: s.peerId,
    vectorClock: { ...s.vectorClock },
  };

  s.operations.push(op);
  s.pendingSync.push(op);
  saveCRDTState();
  return op;
}

/** Create a full document set (LWW) */
export function createSet(
  path: string,
  value: string,
): CRDTOperation {
  const s = ensureState();

  s.lamportClock++;
  s.vectorClock[s.peerId] = s.lamportClock;

  const op: CRDTOperation = {
    id: `${s.peerId}-${s.lamportClock}`,
    type: "set",
    path,
    position: 0,
    value,
    timestamp: s.lamportClock,
    peerId: s.peerId,
    vectorClock: { ...s.vectorClock },
  };

  s.operations.push(op);
  s.pendingSync.push(op);
  saveCRDTState();
  return op;
}

// ── Merge ───────────────────────────────────────────────────────────────

/** Merge remote operations into local state */
export function mergeOperations(remoteOps: CRDTOperation[]): void {
  const s = ensureState();

  for (const remoteOp of remoteOps) {
    // Skip if already seen
    if (s.operations.some((op) => op.id === remoteOp.id)) continue;

    // Update lamport clock
    s.lamportClock = Math.max(s.lamportClock, remoteOp.timestamp) + 1;

    // Merge vector clock
    for (const [peer, clock] of Object.entries(remoteOp.vectorClock)) {
      s.vectorClock[peer] = Math.max(s.vectorClock[peer] ?? 0, clock);
    }

    s.operations.push(remoteOp);
  }

  // Sort by lamport timestamp, then peer ID for deterministic ordering
  s.operations.sort((a, b) =>
    a.timestamp !== b.timestamp
      ? a.timestamp - b.timestamp
      : a.peerId.localeCompare(b.peerId),
  );

  saveCRDTState();
}

/** Apply operations to get the current document state for a given path */
export function resolveDocument(path: string): string {
  if (!state) return "";

  const ops = state.operations
    .filter((op) => op.path === path)
    .sort((a, b) =>
      a.timestamp !== b.timestamp
        ? a.timestamp - b.timestamp
        : a.peerId.localeCompare(b.peerId),
    );

  // Start with the latest "set" operation
  let content = "";
  let startIdx = 0;

  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].type === "set") {
      content = ops[i].value ?? "";
      startIdx = i + 1;
      break;
    }
  }

  // Apply insert/delete operations after the last set
  for (let i = startIdx; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === "insert" && op.content) {
      const pos = Math.min(op.position, content.length);
      content = content.slice(0, pos) + op.content + content.slice(pos);
    } else if (op.type === "delete" && op.length) {
      const pos = Math.min(op.position, content.length);
      const end = Math.min(pos + op.length, content.length);
      content = content.slice(0, pos) + content.slice(end);
    }
  }

  return content;
}

/** Get pending operations for sync */
export function getPendingOps(): CRDTOperation[] {
  return state?.pendingSync ?? [];
}

/** Mark operations as synced */
export function markSynced(opIds: string[]): void {
  if (!state) return;
  const idSet = new Set(opIds);
  state.pendingSync = state.pendingSync.filter((op) => !idSet.has(op.id));
  saveCRDTState();
}

/** Get CRDT stats */
export function getCRDTStats(): {
  peerId: string;
  totalOps: number;
  pendingOps: number;
  lamportClock: number;
} | null {
  if (!state) return null;
  return {
    peerId: state.peerId,
    totalOps: state.operations.length,
    pendingOps: state.pendingSync.length,
    lamportClock: state.lamportClock,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function generatePeerId(): string {
  return `peer-${Date.now().toString(36)}-${randomId(4)}`;
}

async function saveCRDTState(): Promise<void> {
  if (!state) return;
  // Only persist a reasonable number of ops
  const trimmed = {
    ...state,
    operations: state.operations.slice(-10000),
  };
  await set(IDB_KEY, trimmed).catch(() => {});
}
