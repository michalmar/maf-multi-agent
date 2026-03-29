"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

/* ── Types ─────────────────────────────────────────── */

export type ToastLevel = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  level: ToastLevel;
}

/* ── Hook ──────────────────────────────────────────── */

let _nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (message: string, level: ToastLevel = "info", durationMs = 4000) => {
      const id = `toast-${++_nextId}`;
      setToasts((prev) => [...prev.slice(-4), { id, message, level }]);
      const timer = setTimeout(() => dismiss(id), durationMs);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return { toasts, addToast, dismiss };
}

/* ── Component ─────────────────────────────────────── */

const LEVEL_STYLES: Record<ToastLevel, { icon: typeof Info; color: string; bg: string }> = {
  success: { icon: CheckCircle2, color: "var(--success, #0f9f7c)", bg: "rgba(15,159,124,0.10)" },
  error: { icon: AlertTriangle, color: "var(--danger, #d14343)", bg: "rgba(209,67,67,0.10)" },
  info: { icon: Info, color: "var(--accent, #635bff)", bg: "rgba(99,91,255,0.10)" },
};

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2"
      aria-live="polite"
      aria-label="Notifications"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const style = LEVEL_STYLES[toast.level];
          const Icon = style.icon;
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-[var(--border-soft)] px-4 py-3 shadow-lg backdrop-blur-md"
              style={{ background: style.bg, minWidth: 260, maxWidth: 380 }}
              role="status"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: style.color }} />
              <p className="flex-1 text-sm leading-5 text-[var(--text-primary)]">{toast.message}</p>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
