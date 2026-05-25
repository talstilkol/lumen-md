/**
 * useCollab – encapsulates Yjs WebRTC collaboration state.
 *
 * Extracted from App.tsx to prevent connection leaks and keep the
 * collaboration lifecycle in a single, testable unit.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectCollab,
  makeRoomName,
  readRoomFromHash,
  setRoomInHash,
  snapshotPeers,
} from "../collab/yjs";
import type { CollabPeer, CollabSession } from "../collab/yjs";
import { log } from "../lib/logger";
import { recordAudit } from "../lib/audit";

type CollabSessionWithCleanup = CollabSession & { __cleanup?: () => void };
import { useAppStore } from "../store/useStore";
import { uiConfirm } from "../ui/PromptDialog";
import { t } from "../i18n";

export interface UseCollabReturn {
  collab: CollabSession | null;
  collabPeers: CollabPeer[];
  handleStartCollab: (roomOverride?: string) => void;
  handleStopCollab: () => void;
}

export function useCollab(docContent: string): UseCollabReturn {
  const [collab, setCollab] = useState<CollabSession | null>(null);
  const [collabPeers, setCollabPeers] = useState<CollabPeer[]>([]);

  // Keep docContent fresh for the start handler without re-creating
  // the callback on every keystroke.
  const contentRef = useRef(docContent);
  contentRef.current = docContent;

  const handleStartCollab = useCallback(
    (joinName?: string) => {
      if (collab) return;
      const name = joinName ?? makeRoomName();
      try {
        const session = connectCollab(name, contentRef.current);
        setCollab(session);
        setRoomInHash(name);

        // Mirror Yjs text changes back into the doc store so the preview pane
        // stays current.
        const observer = () => {
          try {
            const text = session.ytext.toString();
            useAppStore.getState().setContent(text);
            useAppStore.getState().markSaved();
          } catch (err) {
            log.warn("collab observer error", err);
          }
        };
        session.ytext.observe(observer);

        const awarenessTick = () => {
          try {
            setCollabPeers(snapshotPeers(session));
          } catch {
            /* awareness snapshot failed — non-fatal */
          }
        };
        session.awareness.on("change", awarenessTick);
        awarenessTick();

        // Stash cleanup on the session for handleStopCollab to use.
        (session as CollabSessionWithCleanup).__cleanup = () => {
          session.ytext.unobserve(observer);
          session.awareness.off("change", awarenessTick);
        };

        if (!joinName) {
          const link = `${location.origin}${location.pathname}#room=${name}`;
          navigator.clipboard?.writeText(link).catch(() => {});
        }
        // ε.2 — record start/join. Counts-only payload so the audit
        // log doesn't leak the room name (which can be brand-named).
        const userId = (useAppStore.getState() as { user?: { id?: string } }).user?.id;
        if (userId) {
          recordAudit(userId, joinName ? "collab.join" : "collab.start", {
            payload: { roomNameLength: name.length },
          });
        }
      } catch (err) {
        log.error("collab init failed", err);
        // Reset state so user can retry
        setCollab(null);
        setCollabPeers([]);
        setRoomInHash(null);
      }
    },
    [collab],
  );

  const handleStopCollab = useCallback(() => {
    if (!collab) return;
    (collab as CollabSessionWithCleanup).__cleanup?.();
    collab.destroy();
    setCollab(null);
    setCollabPeers([]);
    setRoomInHash(null);
    const userId = (useAppStore.getState() as { user?: { id?: string } }).user?.id;
    if (userId) {
      recordAudit(userId, "collab.stop", { payload: {} });
    }
  }, [collab]);

  // On first load, if the URL contains #room=, offer to join.
  useEffect(() => {
    const hashRoom = readRoomFromHash();
    if (hashRoom && !collab) {
      const timer = setTimeout(async () => {
        const ok = await uiConfirm({ message: t("collab.prompt.join", { room: hashRoom }) });
        if (ok) handleStartCollab(hashRoom);
      }, 600);
      return () => clearTimeout(timer);
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Strict cleanup on unmount to prevent WebRTC leaks.
  useEffect(() => {
    return () => {
      if (collab) {
        (collab as CollabSessionWithCleanup).__cleanup?.();
        collab.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab]);

  return { collab, collabPeers, handleStartCollab, handleStopCollab };
}
