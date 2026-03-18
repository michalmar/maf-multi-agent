"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { getAgentIdentity, getStatusTone } from "@/lib/agent-metadata";
import { AgentDefinition, AgentStatus, RunSource } from "@/lib/types";

interface AgentRosterProps {
  agents: AgentDefinition[];
  activeAgent: string | null;
  eventCounts: Record<string, number>;
  highlightedTask: number | null;
  liveMetrics: Array<{ label: string; value: string }>;
  runSource: RunSource;
  selectedAgentSummary: { title: string; subtitle: string; body: string };
  statusByAgent: Record<string, AgentStatus>;
  onSelectAgent: (agentName: string | null) => void;
}

interface NodeLayout {
  left: number;
  top: number;
  width: number;
}

const ORCHESTRATOR_WIDTH = 248;
const NODE_WIDTH = 198;
const NODE_HEIGHT = 108;
const CANVAS_HEIGHT = 332;

function buildChildLayouts(count: number, canvasWidth: number) {
  if (count === 0) {
    return [];
  }

  const gap = count > 1 ? (canvasWidth - NODE_WIDTH * count) / (count + 1) : (canvasWidth - NODE_WIDTH) / 2;

  return Array.from({ length: count }, (_, index) => ({
    left: Math.round(gap + index * (NODE_WIDTH + gap)),
    top: 192,
    width: NODE_WIDTH,
  }));
}

function connectorPath(master: NodeLayout, child: NodeLayout) {
  const masterX = master.left + master.width / 2;
  const masterY = master.top + NODE_HEIGHT - 8;
  const childX = child.left + child.width / 2;
  const childY = child.top + 10;
  const midY = masterY + (childY - masterY) * 0.52;

  return `M ${masterX} ${masterY} C ${masterX} ${midY}, ${childX} ${midY - 14}, ${childX} ${childY}`;
}

export function AgentRoster({
  agents,
  activeAgent,
  eventCounts,
  highlightedTask,
  liveMetrics,
  runSource,
  selectedAgentSummary,
  statusByAgent,
  onSelectAgent,
}: AgentRosterProps) {
  const orchestrator = agents.find((agent) => agent.name === "orchestrator");
  const specialists = agents.filter((agent) => agent.name !== "orchestrator");

  const graph = useMemo(() => {
    const canvasWidth = Math.max(900, specialists.length * 214 + 100);
    const master: NodeLayout = {
      left: Math.round((canvasWidth - ORCHESTRATOR_WIDTH) / 2),
      top: 26,
      width: ORCHESTRATOR_WIDTH,
    };

    return {
      canvasWidth,
      master,
      children: buildChildLayouts(specialists.length, canvasWidth),
    };
  }, [specialists.length]);

  const maxEvents = Math.max(...Object.values(eventCounts), 1);

  return (
    <section className="panel-shell flex h-full flex-col p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Crew roster</p>
          <h2 className="section-title mt-2">Operational graph</h2>
          <p className="section-copy mt-2 max-w-2xl">
            A cleaner network view for the orchestrator and specialist agents, with the same selection and progress behavior.
          </p>
        </div>

        {activeAgent ? (
          <button type="button" className="secondary-button" onClick={() => onSelectAgent(null)}>
            Clear focus
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          {liveMetrics.map((metric) => (
            <div key={metric.label} className="metric-card">
              <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{metric.label}</span>
              <p className="mt-3 font-mono text-2xl text-[var(--text-primary)]">{metric.value}</p>
            </div>
          ))}
        </div>

        <div className="inspector-card">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
            {runSource === "mock" ? "Mock replay context" : "Selection inspector"}
          </p>
          <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">{selectedAgentSummary.title}</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{selectedAgentSummary.subtitle}</p>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{selectedAgentSummary.body}</p>
          {highlightedTask !== null ? (
            <p className="mt-3 text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Task #{highlightedTask} highlighted</p>
          ) : null}
        </div>
      </div>

      <div className="graph-shell mt-4 flex-1 overflow-x-auto">
        <div className="relative min-w-[900px]" style={{ height: CANVAS_HEIGHT, width: graph.canvasWidth }}>
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${graph.canvasWidth} ${CANVAS_HEIGHT}`}
            fill="none"
            aria-hidden="true"
          >
            {specialists.map((agent, index) => {
              const status = statusByAgent[agent.name] ?? "idle";
              const statusTone = getStatusTone(status);
              const isActive = activeAgent === agent.name;
              const path = connectorPath(graph.master, graph.children[index]);

              return (
                <g key={agent.name}>
                  <path d={path} className="graph-connector-base" />
                  <path
                    d={path}
                    className={status === "working" ? "graph-connector-live" : "graph-connector-state"}
                    style={{
                      stroke: statusTone.color,
                      opacity: isActive || status !== "idle" ? 1 : 0.34,
                    }}
                  />
                </g>
              );
            })}
          </svg>

          {orchestrator ? (
            <RosterNode
              key={orchestrator.name}
              active={activeAgent === orchestrator.name}
              agent={orchestrator}
              eventCount={eventCounts[orchestrator.name] ?? 0}
              left={graph.master.left}
              onSelectAgent={onSelectAgent}
              progress={Math.round(((eventCounts[orchestrator.name] ?? 0) / maxEvents) * 100)}
              status={statusByAgent[orchestrator.name] ?? "idle"}
              top={graph.master.top}
              width={graph.master.width}
            />
          ) : null}

          {specialists.map((agent, index) => (
            <RosterNode
              key={agent.name}
              active={activeAgent === agent.name}
              agent={agent}
              eventCount={eventCounts[agent.name] ?? 0}
              left={graph.children[index].left}
              onSelectAgent={onSelectAgent}
              progress={Math.round(((eventCounts[agent.name] ?? 0) / maxEvents) * 100)}
              status={statusByAgent[agent.name] ?? "idle"}
              top={graph.children[index].top}
              width={graph.children[index].width}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface RosterNodeProps {
  active: boolean;
  agent: AgentDefinition;
  eventCount: number;
  left: number;
  onSelectAgent: (agentName: string | null) => void;
  progress: number;
  status: AgentStatus;
  top: number;
  width: number;
}

function RosterNode({
  active,
  agent,
  eventCount,
  left,
  onSelectAgent,
  progress,
  status,
  top,
  width,
}: RosterNodeProps) {
  const identity = getAgentIdentity(agent);
  const statusTone = getStatusTone(status);

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      onClick={() => onSelectAgent(active ? null : agent.name)}
      className={`graph-node ${active ? "graph-node-active" : ""}`}
      style={{
        left,
        top,
        width,
        borderColor: identity.border,
        background: identity.soft,
        boxShadow: active ? `0 0 0 1px ${identity.accent}` : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="graph-avatar" style={{ color: identity.accent, borderColor: identity.border }}>
              {identity.avatar}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                {identity.displayName}
              </p>
              <p className="truncate text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{identity.role}</p>
            </div>
          </div>
        </div>

        <span
          className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: statusTone.color, background: statusTone.background }}
        >
          {statusTone.label}
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="graph-meter flex-1">
          <span
            className={`graph-meter-bar ${status === "working" ? "graph-meter-bar-live" : ""}`}
            style={{ width: `${Math.max(progress, 10)}%`, background: statusTone.color }}
          />
        </div>
        <div className="text-right">
          <div className="font-mono text-base text-[var(--text-primary)]">{eventCount}</div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">events</div>
        </div>
      </div>
    </motion.button>
  );
}
