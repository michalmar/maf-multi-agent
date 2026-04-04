"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, Search, Trash2, Play, Loader2, User } from "lucide-react";
import type { HistoryItem } from "@/lib/types";

interface HistoryPanelProps {
  collapsed: boolean;
  items: HistoryItem[];
  activeRunId: string | null;
  onLoad: (runId: string) => void;
  onDelete: (runId: string) => void;
  loading: boolean;
  currentUserEmail?: string;
}

function relativeTime(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diffS = Math.round((now - d.getTime()) / 1000);
    if (diffS < 60) return "just now";
    const diffM = Math.floor(diffS / 60);
    if (diffM < 60) return `${diffM}m ago`;
    const diffH = Math.floor(diffM / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
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
  currentUserEmail,
}: HistoryPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup confirm timer on unmount
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const startConfirm = useCallback((runId: string) => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDelete(runId);
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(null), 3000);
  }, []);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item) => item.query.toLowerCase().includes(q));
  }, [items, search]);

  if (collapsed) {
    return (
      <div className="history-panel-collapsed" aria-label="History (collapsed)">
        <Clock className="h-4 w-4 text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="history-panel" role="region" aria-label="Session history">
      <div className="history-panel-header">
        <h3 style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
          <Clock className="h-3.5 w-3.5" />
          History
          {items.length > 0 && (
            <span className="history-count">({items.length})</span>
          )}
        </h3>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-[var(--text-muted)]" /> : null}
      </div>

      {items.length > 5 && (
        <div className="history-search">
          <Search className="h-3 w-3 text-[var(--text-muted)]" />
          <input
            type="search"
            placeholder="Filter sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="history-search-input"
            aria-label="Filter session history"
          />
        </div>
      )}

      {filteredItems.length === 0 ? (
        <p className="history-panel-empty">
          {items.length === 0 ? "No saved sessions yet." : "No matching sessions."}
        </p>
      ) : (
        <div className="history-panel-list">
          {filteredItems.map((item) => {
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
                  aria-label={`Load session: ${truncateQuery(item.query, 40)}`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <span className="history-item-time">{relativeTime(item.timestamp)}</span>
                  {item.user_email &&
                    currentUserEmail &&
                    item.user_email.toLowerCase() !== currentUserEmail.toLowerCase() && (
                      <span className="history-item-user" title={item.user_email}>
                        <User className="h-2.5 w-2.5" />
                        {item.user_email.split("@")[0]}
                      </span>
                    )}
                  <span className="history-item-query">{truncateQuery(item.query)}</span>
                  <span className="history-item-meta">
                    {item.event_count} events
                    {item.status === "error" ? " · ⚠️" : ""}
                  </span>
                </button>
                <div className="history-item-actions">
                  {isActive ? (
                    <Play className="h-3.5 w-3.5 text-[var(--accent)]" aria-label="Currently active" />
                  ) : confirmDelete === item.run_id ? (
                    <button
                      type="button"
                      className="history-delete-confirm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item.run_id);
                        setConfirmDelete(null);
                        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                      }}
                      aria-label="Confirm delete"
                    >
                      confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="history-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        startConfirm(item.run_id);
                      }}
                      aria-label="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
