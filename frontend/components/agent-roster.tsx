"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  MessageCirclePlus,
} from "lucide-react";
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
  onNewSession: () => void;
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

export function AgentRoster({
  agents,
  activeAgent,
  collapsed,
  enabledAgents,
  fabricStatus: _fabricStatus,
  highlightedTask,
  liveMetrics,
  onSelectAgent,
  onResumeFabric: _onResumeFabric,
  onToggle,
  onToggleAgent,
  onNewSession,
  running,
  runSource,
  selectedAgentSummary,
  statusByAgent,
}: AgentRosterProps) {
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 py-3">
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={onNewSession}
            className="sidebar-icon-btn sidebar-icon-btn-primary"
            title="New session"
            aria-label="Start a new session"
          >
            <MessageCirclePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="sidebar-toggle-btn"
            title="Expand sidebar"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

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
              <span className="sidebar-agent-avatar">
                <identity.icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <span
                className="sidebar-status-dot"
                style={{ background: statusTone.color }}
              />
            </button>
          );
        })}

      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Agents</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewSession}
            className="sidebar-icon-btn sidebar-icon-btn-primary"
            title="New session"
            aria-label="Start a new session"
          >
            <MessageCirclePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="sidebar-toggle-btn"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {liveMetrics.map((metric) => (
          <div key={metric.label} className="sidebar-metric">
            <span className="sidebar-metric-label">{metric.label}</span>
            <span className="sidebar-metric-value">{metric.value}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 space-y-1">
        {agents.map((agent, index) => {
          const identity = getAgentIdentity(agent);
          const status = statusByAgent[agent.name] ?? "idle";
          const statusTone = getStatusTone(status);
          const isActive = activeAgent === agent.name;
          const isOrchestrator = agent.name === "orchestrator";
          const isEnabled = isOrchestrator || enabledAgents.has(agent.name);

          return (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: index * 0.03 }}
              className={`flex items-center gap-1.5 ${!isEnabled ? "opacity-60" : ""}`}
            >
              <button
                type="button"
                onClick={() => onSelectAgent(isActive ? null : agent.name)}
                className={`sidebar-agent-row flex-1 ${isActive ? "sidebar-agent-row-active" : ""} ${statusAnimationClass(status)}`}
                title={`${identity.displayName} — ${statusTone.label}`}
              >
                <span className="sidebar-agent-avatar">
                  <identity.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="truncate text-[0.8rem] font-medium text-[var(--text-primary)] flex-1 text-left">
                  {identity.displayName}
                </span>
              </button>
              {!isOrchestrator ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`${isEnabled ? "Disable" : "Enable"} ${identity.displayName}`}
                  onClick={(e) => { e.stopPropagation(); onToggleAgent(agent.name); }}
                  disabled={running}
                  title={`${isEnabled ? "Disable" : "Enable"} ${identity.displayName}`}
                  className={`sidebar-switch ${isEnabled ? "sidebar-switch-on" : ""} ${running ? "sidebar-switch-disabled" : ""}`}
                >
                  <span className="sidebar-switch-thumb" />
                </button>
              ) : (
                <span className="sidebar-switch-placeholder" aria-hidden="true" />
              )}
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
