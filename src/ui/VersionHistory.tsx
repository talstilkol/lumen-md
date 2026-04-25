import { useState, useEffect, useCallback } from "react";

/**
 * Version history stored in IndexedDB. Each "snapshot" captures the
 * document content + timestamp so the user can restore earlier states.
 */

interface Snapshot {
  id: number;
  name: string;
  content: string;
  timestamp: number;
}

const DB_NAME = "lumen-history";
const STORE_NAME = "snapshots";
const MAX_SNAPSHOTS = 50;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("name", "name", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save a snapshot. Auto-deduplicates identical content. */
export async function saveSnapshot(name: string, content: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  // Don't save if content matches the most recent snapshot for this name
  const index = store.index("name");
  const existing: Snapshot[] = await new Promise((resolve) => {
    const req = index.getAll(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve([]);
  });
  
  const latest = existing.sort((a, b) => b.timestamp - a.timestamp)[0];
  if (latest && latest.content === content) return;

  store.add({ name, content, timestamp: Date.now() });

  // Prune old snapshots beyond MAX
  if (existing.length >= MAX_SNAPSHOTS) {
    const oldest = existing.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < oldest.length - MAX_SNAPSHOTS + 1; i++) {
      store.delete(oldest[i].id);
    }
  }

  db.close();
}

/** Load all snapshots for a file name, newest first. */
export async function loadSnapshots(name: string): Promise<Snapshot[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const index = tx.objectStore(STORE_NAME).index("name");
  const results: Snapshot[] = await new Promise((resolve) => {
    const req = index.getAll(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve([]);
  });
  db.close();
  return results.sort((a, b) => b.timestamp - a.timestamp);
}

/* ─── React component ─── */

interface Props {
  fileName: string;
  currentContent: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}

export function VersionHistory({ fileName, currentContent, onRestore, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<Snapshot | null>(null);

  useEffect(() => {
    loadSnapshots(fileName).then(setSnapshots);
  }, [fileName]);

  const handleRestore = useCallback(() => {
    if (selected) {
      onRestore(selected.content);
      onClose();
    }
  }, [selected, onRestore, onClose]);

  const diffChars = selected
    ? Math.abs(selected.content.length - currentContent.length)
    : 0;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      display: "flex",
      background: "hsl(0 0% 0% / 0.5)",
      backdropFilter: "blur(4px)",
    }}>
      {/* Sidebar: snapshot list */}
      <div style={{
        width: 280,
        background: "hsl(var(--bg))",
        borderRight: "1px solid hsl(var(--border))",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))" }}>
          <h3 style={{ margin: 0, fontSize: 14, color: "hsl(var(--fg))" }}>Version History</h3>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "hsl(var(--fg-muted))" }}>{snapshots.length} versions saved</p>
        </div>
        {snapshots.map((snap) => (
          <button
            key={snap.id}
            onClick={() => setSelected(snap)}
            style={{
              padding: "10px 16px",
              border: "none",
              background: selected?.id === snap.id ? "hsl(var(--accent) / 0.12)" : "transparent",
              color: "hsl(var(--fg))",
              textAlign: "start",
              cursor: "pointer",
              borderBottom: "1px solid hsl(var(--border))",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500 }}>
              {new Date(snap.timestamp).toLocaleString()}
            </div>
            <div style={{ fontSize: 10, color: "hsl(var(--fg-muted))" }}>
              {snap.content.length} chars
            </div>
          </button>
        ))}
        {snapshots.length === 0 && (
          <div style={{ padding: 16, color: "hsl(var(--fg-muted))", fontSize: 12 }}>
            No versions saved yet. Versions are auto-saved when you switch files or save.
          </div>
        )}
      </div>

      {/* Preview pane */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "hsl(var(--bg))",
          borderBottom: "1px solid hsl(var(--border))",
        }}>
          <div style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }}>
            {selected ? `Δ ${diffChars} chars difference` : "Select a version to preview"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selected && (
              <button onClick={handleRestore} style={{
                padding: "4px 12px",
                fontSize: 12,
                border: "none",
                borderRadius: 6,
                background: "hsl(var(--accent))",
                color: "white",
                cursor: "pointer",
                fontWeight: 600,
              }}>
                Restore this version
              </button>
            )}
            <button onClick={onClose} className="icon-btn" style={{ width: "auto", padding: "4px 12px", fontSize: 12 }}>
              Close
            </button>
          </div>
        </div>
        <pre style={{
          flex: 1,
          margin: 0,
          padding: 16,
          fontSize: 12,
          lineHeight: 1.6,
          color: "hsl(var(--fg))",
          background: "hsl(var(--bg-subtle))",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
        }}>
          {selected?.content ?? ""}
        </pre>
      </div>
    </div>
  );
}
