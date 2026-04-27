import { create } from "zustand";
import { randomId } from "../lib/cryptoRandom";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Auto-dismiss after this many ms. 0 = sticky (user must dismiss). */
  ttlMs: number;
}

interface ToastState {
  toasts: Toast[];
  push: (
    toast: Omit<Toast, "id" | "ttlMs"> & Partial<Pick<Toast, "ttlMs">>,
  ) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_TOASTS = 4;

const DEFAULT_TTL: Record<ToastKind, number> = {
  info: 4000,
  success: 3500,
  warning: 6000,
  error: 0,
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (incoming) => {
    const id = randomId(4);
    const ttlMs = incoming.ttlMs ?? DEFAULT_TTL[incoming.kind];
    const toast: Toast = { id, ttlMs, ...incoming };
    set((s) => ({
      toasts: [...s.toasts, toast].slice(-MAX_TOASTS),
    }));
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helpers for non-React callers (logger, AI layer, etc.). */
export const toast = {
  info: (title: string, body?: string) =>
    useToastStore.getState().push({ kind: "info", title, body }),
  success: (title: string, body?: string) =>
    useToastStore.getState().push({ kind: "success", title, body }),
  warn: (title: string, body?: string) =>
    useToastStore.getState().push({ kind: "warning", title, body }),
  error: (title: string, body?: string) =>
    useToastStore.getState().push({ kind: "error", title, body }),
};
