import { useEffect } from "react";
import { X, Info, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { useToastStore, type Toast as ToastType, type ToastKind } from "../store/useToastStore";

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const KIND_CLASSES: Record<ToastKind, string> = {
  info: "border-l-sky-400 bg-sky-50 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100 dark:border-l-sky-500",
  success:
    "border-l-emerald-400 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-l-emerald-500",
  warning:
    "border-l-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 dark:border-l-amber-500",
  error:
    "border-l-rose-500 bg-rose-50 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100 dark:border-l-rose-500",
};

function ToastCard({ toast }: { toast: ToastType }) {
  const Icon = ICONS[toast.kind];
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (toast.ttlMs <= 0) return;
    const handle = window.setTimeout(() => dismiss(toast.id), toast.ttlMs);
    return () => window.clearTimeout(handle);
  }, [toast.id, toast.ttlMs, dismiss]);

  const isAlert = toast.kind === "error" || toast.kind === "warning";

  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      className={
        "pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md border-l-4 p-3 shadow-md ring-1 ring-black/5 dark:ring-white/10 " +
        KIND_CLASSES[toast.kind]
      }
    >
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{toast.title}</div>
        {toast.body ? (
          <div className="mt-1 text-xs opacity-90 break-words">{toast.body}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-1 opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex flex-col gap-2 [direction:ltr]"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
