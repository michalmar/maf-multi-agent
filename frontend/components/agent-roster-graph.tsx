"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Network, Circle, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { getAgentIdentity, getStatusTone } from "@/lib/agent-metadata";
import { AgentDefinition, AgentStatus } from "@/lib/types";

interface AgentRosterGraphProps {
  agents: AgentDefinition[];
  activeAgent: string | null;
  enabledAgents: Set<string>;
  eventCounts: Record<string, number>;
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
const NODE_HEIGHT = 90;
const CANVAS_HEIGHT = 310;

function buildChildLayouts(count: number, canvasWidth: number) {
  if (count === 0) {
    return [];
  }

  const gap =
    count > 1
      ? (canvasWidth - NODE_WIDTH * count) / (count + 1)
      : (canvasWidth - NODE_WIDTH) / 2;

  return Array.from({ length: count }, (_, index) => ({
    left: Math.round(gap + index * (NODE_WIDTH + gap)),
    top: 192,
    width: NODE_WIDTH,
  }));
}

function connectorPath(master: NodeLayout, child: NodeLayout) {
  const masterX = master.left + master.width / 2;
  const masterY = master.top + NODE_HEIGHT;
  const childX = child.left + child.width / 2;
  const childY = child.top;
  const midY = Math.round(masterY + (childY - masterY) / 2);
  const r = 8;

  if (Math.abs(masterX - childX) < 2) {
    return `M ${masterX} ${masterY} L ${masterX} ${childY}`;
  }

  const dx = childX > masterX ? 1 : -1;
  return [
    `M ${masterX} ${masterY}`,
    `L ${masterX} ${midY - r}`,
    `Q ${masterX} ${midY} ${masterX + dx * r} ${midY}`,
    `L ${childX - dx * r} ${midY}`,
    `Q ${childX} ${midY} ${childX} ${midY + r}`,
    `L ${childX} ${childY}`,
  ].join(" ");
}

const STATUS_ICONS: Record<string, typeof Circle> = {
  idle: Circle,
  working: Loader2,
  done: CheckCircle2,
  error: AlertTriangle,
};

export function AgentRosterGraph({
  agents,
  activeAgent,
  enabledAgents,
  eventCounts,
  statusByAgent,
  onSelectAgent,
}: AgentRosterGraphProps) {
  const [expanded, setExpanded] = useState(false);

  const orchestrator = agents.find((agent) => agent.name === "orchestrator");
  const specialists = agents.filter(
    (agent) => agent.name !== "orchestrator" && enabledAgents.has(agent.name),
  );

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

  const workingCount = Object.values(statusByAgent).filter((s) => s === "working").length;
  const doneCount = Object.values(statusByAgent).filter((s) => s === "done").length;

  return (
    <section className="panel-shell overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-soft)]"
      >
        <Network className="h-4 w-4 text-[var(--text-muted)]" />
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            Agent graph
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            {specialists.length + (orchestrator ? 1 : 0)} agents
          </span>
          {workingCount > 0 && (
            <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              {workingCount} active
            </span>
          )}
          {doneCount > 0 && workingCount === 0 && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--success)]"
              style={{ background: "rgba(16, 185, 129, 0.1)" }}
            >
              {doneCount} done
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-[var(--text-muted)] transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="graph-shell overflow-x-auto px-4 pb-4">
              <div
                className="relative min-w-[900px]"
                style={{ height: CANVAS_HEIGHT, width: graph.canvasWidth }}
              >
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${graph.canvasWidth} ${CANVAS_HEIGHT}`}
                  fill="none"
                  aria-hidden="true"
                >
                  {/* Grid pattern */}
                  <defs>
                    <pattern id="graph-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" className="graph-gridline" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#graph-grid)" />
                  {specialists.map((agent, index) => {
                    const status = statusByAgent[agent.name] ?? "idle";
                    const statusTone = getStatusTone(status);
                    const isActive = activeAgent === agent.name;
                    const path = connectorPath(
                      graph.master,
                      graph.children[index],
                    );

                    return (
                      <g key={agent.name}>
                        <path d={path} className="graph-connector-base" />
                        <path
                          d={path}
                          className={
                            status === "working"
                              ? "graph-connector-live"
                              : "graph-connector-state"
                          }
                          style={{
                            stroke: statusTone.color,
                            opacity:
                              isActive || status !== "idle" ? 1 : 0.34,
                          }}
                        />
                      </g>
                    );
                  })}
                </svg>

                {orchestrator ? (
                  <GraphNode
                    active={activeAgent === orchestrator.name}
                    agent={orchestrator}
                    eventCount={eventCounts[orchestrator.name] ?? 0}
                    left={graph.master.left}
                    onSelectAgent={onSelectAgent}
                    status={statusByAgent[orchestrator.name] ?? "idle"}
                    top={graph.master.top}
                    width={graph.master.width}
                  />
                ) : null}

                {specialists.map((agent, index) => (
                  <GraphNode
                    key={agent.name}
                    active={activeAgent === agent.name}
                    agent={agent}
                    eventCount={eventCounts[agent.name] ?? 0}
                    left={graph.children[index].left}
                    onSelectAgent={onSelectAgent}
                    status={statusByAgent[agent.name] ?? "idle"}
                    top={graph.children[index].top}
                    width={graph.children[index].width}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

interface GraphNodeProps {
  active: boolean;
  agent: AgentDefinition;
  eventCount: number;
  left: number;
  onSelectAgent: (agentName: string | null) => void;
  status: AgentStatus;
  top: number;
  width: number;
}

function GraphNode({
  active,
  agent,
  eventCount,
  left,
  onSelectAgent,
  status,
  top,
  width,
}: GraphNodeProps) {
  const identity = getAgentIdentity(agent);
  const statusTone = getStatusTone(status);
  const StatusIcon = STATUS_ICONS[status] ?? Circle;

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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span
              className="graph-avatar"
              style={{
                color: identity.accent,
                borderColor: identity.border,
              }}
            >
              {identity.icon ? <identity.icon className="h-3.5 w-3.5" strokeWidth={1.75} /> : null}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                {identity.displayName}
              </p>
              <p className="truncate text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {identity.role}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="graph-event-count font-mono text-[var(--text-muted)]">
            {eventCount}
          </span>
          <span
            className="graph-status-icon"
            style={{ color: statusTone.color }}
            title={statusTone.label}
          >
            <StatusIcon className={`h-3.5 w-3.5 ${status === "working" ? "animate-spin" : ""}`} />
          </span>
        </div>
      </div>
    </motion.button>
  );
}
