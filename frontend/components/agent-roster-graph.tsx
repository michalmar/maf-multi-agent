"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Network } from "lucide-react";
import { getAgentIdentity, getStatusTone } from "@/lib/agent-metadata";
import { AgentDefinition, AgentStatus } from "@/lib/types";

interface AgentRosterGraphProps {
  agents: AgentDefinition[];
  activeAgent: string | null;
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
const NODE_HEIGHT = 108;
const CANVAS_HEIGHT = 332;

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
  const masterY = master.top + NODE_HEIGHT - 8;
  const childX = child.left + child.width / 2;
  const childY = child.top + 10;
  const midY = masterY + (childY - masterY) * 0.52;

  return `M ${masterX} ${masterY} C ${masterX} ${midY}, ${childX} ${midY - 14}, ${childX} ${childY}`;
}

export function AgentRosterGraph({
  agents,
  activeAgent,
  eventCounts,
  statusByAgent,
  onSelectAgent,
}: AgentRosterGraphProps) {
  const [expanded, setExpanded] = useState(false);

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
            {agents.length} agents
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
                    progress={Math.round(
                      ((eventCounts[orchestrator.name] ?? 0) / maxEvents) *
                        100,
                    )}
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
                    progress={Math.round(
                      ((eventCounts[agent.name] ?? 0) / maxEvents) * 100,
                    )}
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
  progress: number;
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
  progress,
  status,
  top,
  width,
}: GraphNodeProps) {
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
            <span
              className="graph-avatar"
              style={{
                color: identity.accent,
                borderColor: identity.border,
              }}
            >
              {identity.avatar}
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

        <span
          className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{
            color: statusTone.color,
            background: statusTone.background,
          }}
        >
          {statusTone.label}
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="graph-meter flex-1">
          <span
            className={`graph-meter-bar ${status === "working" ? "graph-meter-bar-live" : ""}`}
            style={{
              width: `${Math.max(progress, 10)}%`,
              background: statusTone.color,
            }}
          />
        </div>
        <div className="text-right">
          <div className="font-mono text-base text-[var(--text-primary)]">
            {eventCount}
          </div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
            events
          </div>
        </div>
      </div>
    </motion.button>
  );
}
