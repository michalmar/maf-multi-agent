"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Play, Zap } from "lucide-react";
import { getAgentIdentity, getStatusTone } from "@/lib/agent-metadata";
import { AgentDefinition, AgentStatus, FabricStatus, RunSource } from "@/lib/types";

interface AgentRosterProps {
  agents: AgentDefinition[];
  activeAgent: string | null;
  collapsed: boolean;
  enabledAgents: Set<string>;
  eventCounts: Record<string, number>;
  fabricStatus: FabricStatus | null;
  highlightedTask: number | null;
  liveMetrics: Array<{ label: string; value: string }>;
  onSelectAgent: (agentName: string | null) => void;
  onResumeFabric: () => void;
  onToggle: () => void;
  onToggleAgent: (agentName: string) => void;
  running: boolean;
  runSource: RunSource;
  selectedAgentSummary: { title: string; subtitle: string; body: string };
  statusByAgent: Record<string, AgentStatus>;
}

function statusAnimationClass(status: AgentStatus) {
  if (status === "working") return "agent-node-working";
  if (status === "done") return "agent-node-done";
  if (status === "error") return "agent-node-error";
  return "";
}

function fabricStatusIndicator(status: FabricStatus | null, collapsed: boolean, onResume: () => void) {
  if (!status?.enabled) return null;

  const state = status.state ?? "Unknown";
  const isActive = state === "Active";
  const isPaused = state === "Paused" || state === "Suspended";
  const isTransitioning = ["Resuming", "Provisioning", "Scaling", "Preparing"].includes(state);

  const color = isActive ? "#22c55e" : isPaused ? "#ef4444" : isTransitioning ? "#f59e0b" : "#6b7280";
  const bg = isActive ? "rgba(34,197,94,0.12)" : isPaused ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)";
  const label = isActive ? "Active" : state;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1" title={`Fabric: ${label} (${status.sku ?? ""})`}>
        {isPaused ? (
          <button
            type="button"
            onClick={onResume}
            className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:brightness-110"
            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
            title="Resume Fabric capacity"
            aria-label="Resume Fabric capacity"
          >
            <Play className="h-2.5 w-2.5 fill-current" />
          </button>
        ) : (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full"
            style={{ background: bg, color }}
          >
            <Zap className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
      style={{ background: bg }}
    >
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[11px] font-semibold" style={{ color }}>
            Fabric {label}
          </span>
          {status.sku && (
            <span className="text-[10px] text-[var(--text-muted)]">{status.sku}</span>
          )}
        </div>
        {status.name && (
          <span className="block truncate text-[10px] text-[var(--text-muted)]">{status.name}</span>
        )}
      </div>
      {isPaused && (
        <button
          type="button"
          onClick={onResume}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:brightness-110"
          style={{ color: "#22c55e", background: "rgba(34,197,94,0.15)" }}
          title="Resume Fabric capacity"
          aria-label="Resume Fabric capacity"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </button>
      )}
    </div>
  );
}

export function AgentRoster({
  agents,
  activeAgent,
  collapsed,
  enabledAgents,
  eventCounts,
  fabricStatus,
  highlightedTask,
  liveMetrics,
  onSelectAgent,
  onResumeFabric,
  onToggle,
  onToggleAgent,
  running,
  runSource,
  selectedAgentSummary,
  statusByAgent,
}: AgentRosterProps) {
  const maxEvents = Math.max(...Object.values(eventCounts), 1);

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="sidebar-toggle-btn mb-2"
          title="Expand sidebar"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        {agents.map((agent) => {
          const identity = getAgentIdentity(agent);
          const status = statusByAgent[agent.name] ?? "idle";
          const statusTone = getStatusTone(status);
          const isActive = activeAgent === agent.name;
          const isOrchestrator = agent.name === "orchestrator";
          const isEnabled = isOrchestrator || enabledAgents.has(agent.name);

          return (
            <button
              key={agent.name}
              type="button"
              onClick={() => onSelectAgent(isActive ? null : agent.name)}
              className={`sidebar-avatar-btn ${isActive ? "sidebar-avatar-btn-active" : ""} ${statusAnimationClass(status)} ${!isEnabled ? "opacity-35" : ""}`}
              title={`${identity.displayName} — ${statusTone.label}${!isEnabled ? " (disabled)" : ""}`}
            >
              <span
                className="sidebar-agent-avatar"
                style={{ color: identity.accent, borderColor: identity.border }}
              >
                {identity.avatar}
              </span>
              <span
                className="sidebar-status-dot"
                style={{ background: statusTone.color }}
              />
            </button>
          );
        })}

        {fabricStatusIndicator(fabricStatus, true, onResumeFabric)}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Agents</span>
        <button
          type="button"
          onClick={onToggle}
          className="sidebar-toggle-btn"
          title="Collapse sidebar"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {liveMetrics.map((metric) => (
          <div key={metric.label} className="sidebar-metric">
            <span className="sidebar-metric-label">{metric.label}</span>
            <span className="sidebar-metric-value">{metric.value}</span>
          </div>
        ))}
      </div>

      {fabricStatusIndicator(fabricStatus, false, onResumeFabric)}

      <div className="flex-1 space-y-2 overflow-y-auto">
        {agents.map((agent, index) => {
          const identity = getAgentIdentity(agent);
          const status = statusByAgent[agent.name] ?? "idle";
          const statusTone = getStatusTone(status);
          const isActive = activeAgent === agent.name;
          const eventCount = eventCounts[agent.name] ?? 0;
          const progress = Math.round((eventCount / maxEvents) * 100);
          const isOrchestrator = agent.name === "orchestrator";
          const isEnabled = isOrchestrator || enabledAgents.has(agent.name);

          return (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: index * 0.03 }}
              className={`flex items-center gap-1.5 ${!isEnabled ? "opacity-40" : ""}`}
            >
              {!isOrchestrator && (
                <button
                  type="button"
                  aria-label={`${isEnabled ? "Disable" : "Enable"} ${identity.displayName}`}
                  onClick={(e) => { e.stopPropagation(); onToggleAgent(agent.name); }}
                  disabled={running}
                  className="group flex shrink-0 items-center justify-center"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                      isEnabled
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-[var(--border-soft)] bg-transparent"
                    } ${running ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-[var(--accent)]"}`}
                  >
                    {isEnabled && (
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onSelectAgent(isActive ? null : agent.name)}
                className={`sidebar-agent-row flex-1 ${isActive ? "sidebar-agent-row-active" : ""} ${statusAnimationClass(status)}`}
              >
                <span
                  className="sidebar-agent-avatar"
                  style={{ color: identity.accent, borderColor: identity.border }}
                >
                  {identity.avatar}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[0.78rem] font-semibold text-[var(--text-primary)]">
                      {identity.displayName}
                    </span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: statusTone.color, background: statusTone.background }}
                    >
                      {statusTone.label}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="sidebar-progress-track flex-1">
                      <span
                        className={`sidebar-progress-fill ${status === "working" ? "sidebar-progress-fill-live" : ""}`}
                        style={{ width: `${Math.max(progress, 6)}%`, background: statusTone.color }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">{eventCount}</span>
                  </div>
                </div>
              </button>
            </motion.div>
          );
        })}
      </div>

      <div className="sidebar-inspector-card">
        <p className="text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
          {runSource === "mock" ? "Mock context" : "Inspector"}
        </p>
        <p className="mt-1.5 text-xs font-semibold text-[var(--text-primary)]">{selectedAgentSummary.title}</p>
        <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{selectedAgentSummary.subtitle}</p>
        <p className="mt-1.5 text-[11px] leading-[1.5] text-[var(--text-secondary)]">{selectedAgentSummary.body}</p>
        {highlightedTask !== null ? (
          <p className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Task #{highlightedTask} highlighted
          </p>
        ) : null}
      </div>

      {activeAgent ? (
        <button type="button" className="secondary-button w-full text-xs" onClick={() => onSelectAgent(null)}>
          Clear focus
        </button>
      ) : null}
    </div>
  );
}
