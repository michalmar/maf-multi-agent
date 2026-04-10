"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, X, Loader2, Activity, Users, CheckCircle, TrendingUp, AlertCircle, Clock, Zap, Cpu } from "lucide-react";
import type { HistoryItem, TokenUsage } from "@/lib/types";

/* ── Types ─────────────────────────────────────────────────── */

interface UsageStats {
  totalRuns: number;
  todayRuns: number;
  thisWeekRuns: number;
  successRate: number;
  errorCount: number;
  activeUsers: number;
  hasUserData: boolean;
  avgEventsPerRun: number;
  dailyCounts: { date: string; label: string; count: number }[];
  userCounts: { user: string; count: number }[];
  statusCounts: { status: string; count: number; color: string }[];
  recentRuns: HistoryItem[];
  // Token usage aggregates
  hasTokenData: boolean;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalReasoningTokens: number;
  avgTokensPerRun: number;
  tokensBySource: { source: string; model: string; input: number; output: number; total: number; cached: number; reasoning: number }[];
  tokensByModel: { model: string; total: number; input: number; output: number }[];
}

interface UsageDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ── Helpers ───────────────────────────────────────────────── */

function toDateKey(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    // run_id format: YYYYMMDD-HHMMSS-xxx → extract date
    const m = ts.match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  }
}

function toShortDate(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m, 10)]} ${parseInt(d, 10)}`;
}

function isToday(dateKey: string): boolean {
  return dateKey === new Date().toISOString().slice(0, 10);
}

function isThisWeek(dateKey: string): boolean {
  const d = new Date(dateKey);
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  return d >= weekAgo && d <= now;
}

function relativeTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

function computeStats(items: HistoryItem[]): UsageStats {
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasUserData = items.some((i) => !!i.user_email);

  // Status counts
  const statusMap = new Map<string, number>();
  let eventSum = 0;
  for (const item of items) {
    const s = item.status || "unknown";
    statusMap.set(s, (statusMap.get(s) || 0) + 1);
    eventSum += item.event_count || 0;
  }

  const statusColors: Record<string, string> = {
    done: "var(--success)",
    error: "var(--danger)",
    unknown: "var(--text-muted)",
  };
  const statusCounts = Array.from(statusMap.entries())
    .map(([status, count]) => ({ status, count, color: statusColors[status] || "var(--accent)" }))
    .sort((a, b) => b.count - a.count);

  // Daily counts (last 30 days)
  const dailyMap = new Map<string, number>();
  for (const item of items) {
    const dk = toDateKey(item.timestamp || item.run_id);
    if (dk) dailyMap.set(dk, (dailyMap.get(dk) || 0) + 1);
  }
  // Fill in missing days in the last 30 days
  const dailyCounts: { date: string; label: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dk = d.toISOString().slice(0, 10);
    dailyCounts.push({ date: dk, label: toShortDate(dk), count: dailyMap.get(dk) || 0 });
  }

  // User counts
  const userMap = new Map<string, number>();
  if (hasUserData) {
    for (const item of items) {
      const u = item.user_email || "anonymous";
      userMap.set(u, (userMap.get(u) || 0) + 1);
    }
  }
  const userCounts = Array.from(userMap.entries())
    .map(([user, count]) => ({ user, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const doneCount = statusMap.get("done") || 0;
  const errorCount = statusMap.get("error") || 0;
  const total = items.length;

  const todayItems = items.filter((i) => {
    const dk = toDateKey(i.timestamp || i.run_id);
    return dk === todayKey;
  });

  const weekItems = items.filter((i) => {
    const dk = toDateKey(i.timestamp || i.run_id);
    return isThisWeek(dk);
  });

  // Aggregate token usage across all sessions
  let totalTokens = 0, totalInput = 0, totalOutput = 0, totalCached = 0, totalReasoning = 0;
  const sourceAgg = new Map<string, { model: string; input: number; output: number; total: number; cached: number; reasoning: number }>();
  const modelAgg = new Map<string, { total: number; input: number; output: number }>();
  let hasTokenData = false;

  for (const item of items) {
    const tu = item.token_usage;
    if (!tu) continue;
    hasTokenData = true;
    totalTokens += tu.total_tokens || 0;
    totalInput += tu.input_tokens || 0;
    totalOutput += tu.output_tokens || 0;
    totalCached += tu.cached_tokens || 0;
    totalReasoning += tu.reasoning_tokens || 0;

    if (tu.by_source) {
      for (const [src, su] of Object.entries(tu.by_source)) {
        const existing = sourceAgg.get(src);
        if (existing) {
          existing.input += su.input_tokens || 0;
          existing.output += su.output_tokens || 0;
          existing.total += su.total_tokens || 0;
          existing.cached += su.cached_tokens || 0;
          existing.reasoning += su.reasoning_tokens || 0;
        } else {
          sourceAgg.set(src, {
            model: su.model || "unknown",
            input: su.input_tokens || 0,
            output: su.output_tokens || 0,
            total: su.total_tokens || 0,
            cached: su.cached_tokens || 0,
            reasoning: su.reasoning_tokens || 0,
          });
        }

        const mdl = su.model || "unknown";
        const me = modelAgg.get(mdl);
        if (me) {
          me.total += su.total_tokens || 0;
          me.input += su.input_tokens || 0;
          me.output += su.output_tokens || 0;
        } else {
          modelAgg.set(mdl, { total: su.total_tokens || 0, input: su.input_tokens || 0, output: su.output_tokens || 0 });
        }
      }
    }
  }

  const tokensBySource = Array.from(sourceAgg.entries())
    .map(([source, d]) => ({ source, ...d }))
    .sort((a, b) => b.total - a.total);

  const tokensByModel = Array.from(modelAgg.entries())
    .map(([model, d]) => ({ model, ...d }))
    .sort((a, b) => b.total - a.total);

  return {
    totalRuns: total,
    todayRuns: todayItems.length,
    thisWeekRuns: weekItems.length,
    successRate: total > 0 ? Math.round((doneCount / total) * 100) : 0,
    errorCount,
    activeUsers: userMap.size,
    hasUserData,
    avgEventsPerRun: total > 0 ? Math.round(eventSum / total) : 0,
    dailyCounts,
    userCounts,
    statusCounts,
    recentRuns: items.slice(0, 8),
    hasTokenData,
    totalTokens,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCachedTokens: totalCached,
    totalReasoningTokens: totalReasoning,
    avgTokensPerRun: hasTokenData && total > 0 ? Math.round(totalTokens / total) : 0,
    tokensBySource,
    tokensByModel,
  };
}

/* ── Component ─────────────────────────────────────────────── */

export function UsageDashboard({ isOpen, onClose }: UsageDashboardProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement | null;
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && dialogRef.current) dialogRef.current.focus();
  }, [isOpen, loading]);

  // Fetch data
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError("");
    fetch("/api/history")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: HistoryItem[]) => setItems(data))
      .catch((e) => setError(e.message || "Failed to load history"))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // ESC to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose],
  );
  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  const stats = loading || error ? null : computeStats(items);

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
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Usage Dashboard"
            className="dash-dialog"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {/* Header */}
            <div className="dash-header">
              <div className="flex items-center gap-2.5">
                <BarChart3 className="h-5 w-5 text-[var(--accent)]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  Usage Dashboard
                </h2>
                {stats && (
                  <span className="dash-header-badge">{stats.totalRuns} runs</span>
                )}
              </div>
              <button type="button" onClick={onClose} className="secondary-button secondary-button-compact" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="dash-content">
              {loading ? (
                <div className="dash-loading">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
                  <span>Loading usage data…</span>
                </div>
              ) : error ? (
                <div className="dash-loading">
                  <AlertCircle className="h-6 w-6 text-[var(--danger)]" />
                  <span>Failed to load: {error}</span>
                </div>
              ) : stats && stats.totalRuns === 0 ? (
                <div className="dash-loading">
                  <Activity className="h-6 w-6 text-[var(--text-muted)]" />
                  <span>No runs yet. Submit a query to get started.</span>
                </div>
              ) : stats ? (
                <>
                  {/* KPI Cards */}
                  <div className="dash-kpi-grid">
                    <div className="dash-kpi">
                      <div className="dash-kpi-icon"><Activity className="h-4 w-4" /></div>
                      <div className="dash-kpi-value">{stats.totalRuns}</div>
                      <div className="dash-kpi-label">Total Runs</div>
                    </div>
                    <div className="dash-kpi">
                      <div className="dash-kpi-icon" style={{ color: "var(--accent)" }}><TrendingUp className="h-4 w-4" /></div>
                      <div className="dash-kpi-value">{stats.todayRuns}</div>
                      <div className="dash-kpi-label">Today</div>
                    </div>
                    <div className="dash-kpi">
                      <div className="dash-kpi-icon" style={{ color: stats.successRate >= 80 ? "var(--success)" : "var(--danger)" }}>
                        <CheckCircle className="h-4 w-4" />
                      </div>
                      <div className="dash-kpi-value" style={{ color: stats.successRate >= 80 ? "var(--success)" : "var(--danger)" }}>
                        {stats.successRate}%
                      </div>
                      <div className="dash-kpi-label">Success Rate</div>
                    </div>
                    {stats.hasUserData ? (
                      <div className="dash-kpi">
                        <div className="dash-kpi-icon" style={{ color: "var(--accent-warm)" }}><Users className="h-4 w-4" /></div>
                        <div className="dash-kpi-value">{stats.activeUsers}</div>
                        <div className="dash-kpi-label">Users</div>
                      </div>
                    ) : (
                      <div className="dash-kpi">
                        <div className="dash-kpi-icon"><Clock className="h-4 w-4" /></div>
                        <div className="dash-kpi-value">{stats.thisWeekRuns}</div>
                        <div className="dash-kpi-label">This Week</div>
                      </div>
                    )}
                  </div>

                  {/* Daily Activity Chart */}
                  <div className="dash-section">
                    <h3 className="dash-section-title">Daily Activity <span className="dash-section-sub">Last 30 days</span></h3>
                    <DailyChart data={stats.dailyCounts} />
                  </div>

                  {/* Two-column: Users / Status */}
                  <div className="dash-two-col">
                    {stats.hasUserData && stats.userCounts.length > 0 && (
                      <div className="dash-section">
                        <h3 className="dash-section-title">Top Users</h3>
                        <HorizontalBars
                          items={stats.userCounts.map((u) => ({
                            label: u.user.split("@")[0],
                            value: u.count,
                            tooltip: u.user,
                          }))}
                          color="var(--accent)"
                        />
                      </div>
                    )}
                    <div className="dash-section">
                      <h3 className="dash-section-title">Status Breakdown</h3>
                      <HorizontalBars
                        items={stats.statusCounts.map((s) => ({
                          label: s.status,
                          value: s.count,
                          color: s.color,
                        }))}
                      />
                    </div>
                  </div>

                  {/* Token Usage Section */}
                  {stats.hasTokenData && (
                    <>
                      {/* Token KPI row */}
                      <div className="dash-kpi-grid">
                        <div className="dash-kpi">
                          <div className="dash-kpi-icon" style={{ color: "var(--accent)" }}><Zap className="h-4 w-4" /></div>
                          <div className="dash-kpi-value">{formatTokenCount(stats.totalTokens)}</div>
                          <div className="dash-kpi-label">Total Tokens</div>
                        </div>
                        <div className="dash-kpi">
                          <div className="dash-kpi-icon"><Cpu className="h-4 w-4" /></div>
                          <div className="dash-kpi-value">{formatTokenCount(stats.avgTokensPerRun)}</div>
                          <div className="dash-kpi-label">Avg / Run</div>
                        </div>
                        <div className="dash-kpi">
                          <div className="dash-kpi-icon" style={{ color: "var(--success)" }}><Zap className="h-4 w-4" /></div>
                          <div className="dash-kpi-value">{stats.totalTokens > 0 ? Math.round((stats.totalCachedTokens / stats.totalTokens) * 100) : 0}%</div>
                          <div className="dash-kpi-label">Cache Hit</div>
                        </div>
                        <div className="dash-kpi">
                          <div className="dash-kpi-icon" style={{ color: "var(--accent-warm)" }}><Cpu className="h-4 w-4" /></div>
                          <div className="dash-kpi-value">{formatTokenCount(stats.totalReasoningTokens)}</div>
                          <div className="dash-kpi-label">Reasoning</div>
                        </div>
                      </div>

                      {/* Token breakdown: by source + by model */}
                      <div className="dash-two-col">
                        {stats.tokensBySource.length > 0 && (
                          <div className="dash-section">
                            <h3 className="dash-section-title">Tokens by Agent</h3>
                            <HorizontalBars
                              items={stats.tokensBySource.map((s) => ({
                                label: s.source,
                                value: s.total,
                                tooltip: `${s.source} (${s.model}): ${s.total.toLocaleString()} tokens (in=${s.input.toLocaleString()}, out=${s.output.toLocaleString()}${s.cached ? `, cached=${s.cached.toLocaleString()}` : ""}${s.reasoning ? `, reasoning=${s.reasoning.toLocaleString()}` : ""})`,
                              }))}
                              color="var(--accent)"
                              formatValue={formatTokenCount}
                            />
                          </div>
                        )}
                        {stats.tokensByModel.length > 0 && (
                          <div className="dash-section">
                            <h3 className="dash-section-title">Tokens by Model</h3>
                            <HorizontalBars
                              items={stats.tokensByModel.map((m) => ({
                                label: m.model,
                                value: m.total,
                                tooltip: `${m.model}: ${m.total.toLocaleString()} tokens (in=${m.input.toLocaleString()}, out=${m.output.toLocaleString()})`,
                                color: "var(--accent-alt)",
                              }))}
                              formatValue={formatTokenCount}
                            />
                          </div>
                        )}
                      </div>

                      {/* Token type breakdown bar */}
                      <div className="dash-section">
                        <h3 className="dash-section-title">Token Type Distribution</h3>
                        <TokenTypeBar
                          input={stats.totalInputTokens}
                          output={stats.totalOutputTokens}
                          cached={stats.totalCachedTokens}
                          reasoning={stats.totalReasoningTokens}
                        />
                      </div>
                    </>
                  )}

                  {/* Recent Activity */}
                  <div className="dash-section">
                    <h3 className="dash-section-title">Recent Runs</h3>
                    <div className="dash-recent">
                      {stats.recentRuns.map((run) => (
                        <div key={run.run_id} className="dash-recent-row">
                          <span className={`dash-recent-dot ${run.status === "done" ? "dash-dot-ok" : run.status === "error" ? "dash-dot-err" : ""}`} />
                          <span className="dash-recent-time">{relativeTime(run.timestamp)}</span>
                          {run.user_email && <span className="dash-recent-user">{run.user_email.split("@")[0]}</span>}
                          <span className="dash-recent-query">{run.query}</span>
                          <span className="dash-recent-events">{run.event_count} events</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Sub-components ────────────────────────────────────────── */

function DailyChart({ data }: { data: { date: string; label: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  // Show labels every ~5 days
  const labelInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <div className="dash-chart">
      <div className="dash-chart-bars">
        {data.map((d, i) => (
          <div key={d.date} className="dash-chart-col" title={`${d.label}: ${d.count} run${d.count !== 1 ? "s" : ""}`}>
            <div className="dash-chart-bar-wrap">
              <motion.div
                className={`dash-chart-bar ${isToday(d.date) ? "dash-chart-bar-today" : ""}`}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(d.count > 0 ? 8 : 0, (d.count / max) * 100)}%` }}
                transition={{ duration: 0.4, delay: i * 0.015, ease: "easeOut" }}
              />
            </div>
            {i % labelInterval === 0 && (
              <span className="dash-chart-label">{d.label}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizontalBars({ items, color, formatValue }: {
  items: { label: string; value: number; color?: string; tooltip?: string }[];
  color?: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const fmt = formatValue || ((v: number) => String(v));

  return (
    <div className="dash-hbars">
      {items.map((item) => (
        <div key={item.label} className="dash-hbar-row" title={item.tooltip || `${item.label}: ${item.value}`}>
          <span className="dash-hbar-label">{item.label}</span>
          <div className="dash-hbar-track">
            <motion.div
              className="dash-hbar-fill"
              style={{ backgroundColor: item.color || color || "var(--accent)" }}
              initial={{ width: 0 }}
              animate={{ width: `${(item.value / max) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <span className="dash-hbar-value">{fmt(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

function TokenTypeBar({ input, output, cached, reasoning }: {
  input: number; output: number; cached: number; reasoning: number;
}) {
  const total = input + output;
  if (total === 0) return null;
  const segments = [
    { label: "Input", value: input - cached, color: "var(--accent)", pct: ((input - cached) / total) * 100 },
    { label: "Cached", value: cached, color: "var(--success)", pct: (cached / total) * 100 },
    { label: "Output", value: output - reasoning, color: "var(--accent-warm)", pct: ((output - reasoning) / total) * 100 },
    { label: "Reasoning", value: reasoning, color: "var(--accent-alt)", pct: (reasoning / total) * 100 },
  ].filter((s) => s.value > 0);

  return (
    <div className="dash-token-type">
      <div className="dash-token-bar">
        {segments.map((s) => (
          <motion.div
            key={s.label}
            className="dash-token-segment"
            style={{ backgroundColor: s.color, width: `${s.pct}%` }}
            title={`${s.label}: ${s.value.toLocaleString()} tokens (${Math.round(s.pct)}%)`}
            initial={{ width: 0 }}
            animate={{ width: `${s.pct}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        ))}
      </div>
      <div className="dash-token-legend">
        {segments.map((s) => (
          <span key={s.label} className="dash-token-legend-item">
            <span className="dash-token-legend-dot" style={{ backgroundColor: s.color }} />
            {s.label} <span className="dash-token-legend-val">{formatTokenCount(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
