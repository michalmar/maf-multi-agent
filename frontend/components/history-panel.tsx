"use client";

import { useState } from "react";
import { Clock, Trash2, Play, Loader2 } from "lucide-react";
import type { HistoryItem } from "@/lib/types";

interface HistoryPanelProps {
  collapsed: boolean;
  items: HistoryItem[];
  activeRunId: string | null;
  onLoad: (runId: string) => void;
  onDelete: (runId: string) => void;
  loading: boolean;
}

function formatTimestamp(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / (1000 * 60 * 60);

    if (diffH < 24) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (diffH < 24 * 7) {
      return d.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return ts.slice(0, 16);
  }
}

function truncateQuery(query: string, max = 80): string {
  if (query.length <= max) return query;
  return query.slice(0, max) + "…";
}

export function HistoryPanel({
  collapsed,
  items,
  activeRunId,
  onLoad,
  onDelete,
  loading,
}: HistoryPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (collapsed) {
    return (
      <div className="history-panel-collapsed">
        <Clock className="h-4 w-4 text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <h3 style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
          <Clock className="h-3.5 w-3.5" />
          History
        </h3>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-[var(--text-muted)]" /> : null}
      </div>

      {items.length === 0 ? (
        <p className="history-panel-empty">No saved sessions yet.</p>
      ) : (
        <div className="history-panel-list">
          {items.map((item) => {
            const isActive = activeRunId === item.run_id;
            return (
              <div
                key={item.run_id}
                className={`history-item ${isActive ? "history-item-active" : ""}`}
              >
                <button
                  type="button"
                  className="history-item-main"
                  onClick={() => onLoad(item.run_id)}
                  title={item.query}
                  style={{ all: "unset", cursor: "pointer", display: "flex", flexDirection: "column", gap: "3px", minWidth: 0, width: "100%" }}
                >
                  <span className="history-item-time">{formatTimestamp(item.timestamp)}</span>
                  <span className="history-item-query">{truncateQuery(item.query)}</span>
                  <span className="history-item-meta">
                    {item.event_count} events
                    {item.status === "error" ? " · ⚠️" : ""}
                  </span>
                </button>
                <div className="history-item-actions">
                  {isActive ? (
                    <Play className="h-3 w-3 text-[var(--accent)]" />
                  ) : confirmDelete === item.run_id ? (
                    <button
                      type="button"
                      className="history-delete-confirm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item.run_id);
                        setConfirmDelete(null);
                      }}
                    >
                      confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="history-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(item.run_id);
                        setTimeout(() => setConfirmDelete(null), 3000);
                      }}
                      title="Delete session"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
