"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface WhatsNewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WhatsNewModal({ isOpen, onClose }: WhatsNewModalProps) {
  const [changelog, setChangelog] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch("/api/changelog")
      .then((r) => r.ok ? r.text() : "No changelog available.")
      .then(setChangelog)
      .catch(() => setChangelog("Failed to load changelog."))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="What's new"
            className="whats-new-dialog"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {/* Header */}
            <div className="whats-new-header">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[var(--accent)]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  What&apos;s New
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="secondary-button secondary-button-compact"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="whats-new-content">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <span className="text-sm text-[var(--text-muted)]">Loading...</span>
                </div>
              ) : (
                <div className="whats-new-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {changelog}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
