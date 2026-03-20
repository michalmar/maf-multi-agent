"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Brain,
  ChevronRight,
  CircleCheckBig,
  CircleDot,
  Columns3,
  FileText,
  Filter,
  Flag,
  List,
  ListTodo,
  Play,
  Sparkles,
  SquareCheckBig,
  Wrench,
  Zap,
} from "lucide-react";
import { getAgentIdentity } from "@/lib/agent-metadata";
import { AgentEvent } from "@/lib/types";

/* ── Types ─────────────────────────────────────────── */

interface ActivityFeedProps {
  events: AgentEvent[];
  running: boolean;
  activeAgent: string | null;
  highlightedTask: number | null;
}

type ViewMode = "timeline" | "swimlanes";

/* ── Constants ─────────────────────────────────────── */

const EVENT_LABELS: Record<string, string> = {
  workflow_started: "Workflow started",
  workflow_completed: "Workflow completed",
  reasoning: "Reasoning",
  tool_decision: "Tool decision",
  tasks_created: "Tasks created",
  task_completed: "Task completed",
  agent_started: "Agent started",
  agent_completed: "Agent completed",
  agent_error: "Agent error",
  document_updated: "Document updated",
  output: "Final output",
};

const EVENT_ICONS: Record<string, LucideIcon> = {
  workflow_started: Zap,
  workflow_completed: Flag,
  reasoning: Brain,
  tool_decision: Wrench,
  tasks_created: ListTodo,
  task_completed: SquareCheckBig,
  agent_started: Play,
  agent_completed: CircleCheckBig,
  agent_error: AlertTriangle,
  document_updated: FileText,
  output: Sparkles,
};

const NOISE_EVENT_TYPES = new Set(["agent_started", "task_completed"]);

/* ── Helpers ───────────────────────────────────────── */

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function summarizeEvent(event: AgentEvent) {
  const { event_type: type, data } = event;

  if (type === "reasoning") return data.text || "No reasoning text provided.";
  if (type === "tool_decision") return data.tool ? `Preparing ${String(data.tool)}` : "Tool decision recorded.";
  if (type === "tasks_created") return `${Array.isArray(data.tasks) ? data.tasks.length : 0} tasks drafted for dispatch.`;
  if (type === "task_completed") return `Task #${String(data.task_id ?? "?")} marked complete.`;
  if (type === "agent_started") return `${String(data.agent_name ?? event.source)} is now working.`;
  if (type === "agent_completed") {
    const dur = typeof data.elapsed === "number" ? `${data.elapsed.toFixed(1)}s` : "unknown duration";
    return `Completed in ${dur}${typeof data.length === "number" ? ` • ${data.length} chars` : ""}`;
  }
  if (type === "document_updated") return `Document version ${String(data.version ?? "?")} recorded.`;
  if (type === "output") return data.text ? String(data.text).slice(0, 120) : "Final output streamed.";
  if (type === "agent_error") return data.error ? String(data.error) : "The backend reported an error.";
  if (type === "workflow_started") return data.query ? String(data.query).slice(0, 120) : "Mission received.";
  if (type === "workflow_completed")
    return typeof data.elapsed === "number" ? `Workflow completed in ${data.elapsed.toFixed(1)}s.` : "Workflow completed.";
  return JSON.stringify(data);
}

function dotColorForEvent(event: AgentEvent, agentAccent: string): string {
  if (event.event_type === "agent_error") return "var(--danger)";
  if (event.event_type === "workflow_completed" || event.event_type === "agent_completed") return "var(--success)";
  if (event.event_type === "workflow_started") return "var(--accent)";
  return agentAccent;
}

function prettifyData(value: unknown) {
  return JSON.stringify(value, null, 2);
}

/* ── Shared sub-components ─────────────────────────── */

function EventTypeIcon({ type }: { type: string }) {
  const Icon = EVENT_ICONS[type] ?? CircleDot;
  return (
    <span className="tl-icon-wrap" title={EVENT_LABELS[type] || type}>
      <Icon className="tl-icon" />
    </span>
  );
}

function EventDetail({ event }: { event: AgentEvent }) {
  const { event_type: type, data } = event;

  if (type === "tasks_created" && Array.isArray(data.tasks)) {
    return (
      <div className="space-y-2 text-sm text-[var(--text-secondary)]">
        {data.tasks.map((task) => (
          <div key={task.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2">
            <span className="font-mono text-xs text-[var(--text-muted)]">#{task.id}</span>
            <p className="mt-1 text-[var(--text-primary)]">{task.text}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[var(--text-muted)]">{task.assigned_to}</p>
          </div>
        ))}
      </div>
    );
  }

  if (type === "reasoning" && typeof data.text === "string") return <pre className="feed-pre">{data.text}</pre>;
  if (type === "document_updated" && typeof data.content === "string") return <pre className="feed-pre">{data.content}</pre>;
  if (type === "agent_completed" && typeof data.result === "string") return <pre className="feed-pre">{data.result}</pre>;
  return <pre className="feed-pre">{prettifyData(data)}</pre>;
}

function ExpandableDetail({ event }: { event: AgentEvent }) {
  return (
    <AnimatePresence initial={false}>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="overflow-hidden"
      >
        <div className="tl-detail">
          <EventDetail event={event} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Timeline row (single-column view) ─────────────── */

function FeedRow({
  event,
  highlightedTask,
  isLive,
}: {
  event: AgentEvent;
  highlightedTask: number | null;
  isLive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const agent = getAgentIdentity(event.source);
  const dotColor = dotColorForEvent(event, agent.accent);

  const isTaskRelated =
    highlightedTask !== null &&
    ((event.event_type === "task_completed" && event.data.task_id === highlightedTask) ||
      (event.event_type === "agent_started" && event.data.task_id === highlightedTask) ||
      (event.event_type === "tasks_created" &&
        Array.isArray(event.data.tasks) &&
        event.data.tasks.some((task) => task.id === highlightedTask)));

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`tl-item ${isTaskRelated ? "tl-item-highlight" : ""}`}
    >
      <button type="button" className="tl-row" onClick={() => setExpanded((v) => !v)}>
        <span
          className={`tl-dot ${isLive ? "tl-dot-pulse" : ""}`}
          style={{ background: dotColor }}
        />
        <time className="tl-time">{formatTimestamp(event.timestamp)}</time>
        <span className="tl-agent" style={{ color: agent.accent, background: agent.soft }}>
          {agent.displayName}
        </span>
        <EventTypeIcon type={event.event_type} />
        <span className="tl-summary">{summarizeEvent(event)}</span>
        <ChevronRight className={`tl-chevron ${expanded ? "tl-chevron-open" : ""}`} />
      </button>

      {expanded ? <ExpandableDetail event={event} /> : null}
    </motion.div>
  );
}

/* ── Swim-lane item (multi-column view) ────────────── */

function LaneItem({ event, isLive }: { event: AgentEvent; isLive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const agent = getAgentIdentity(event.source);
  const dotColor = dotColorForEvent(event, agent.accent);

  return (
    <div className="tl-lane-item">
      <button type="button" className="tl-lane-row" onClick={() => setExpanded((v) => !v)}>
        <span
          className={`tl-dot tl-dot-sm ${isLive ? "tl-dot-pulse" : ""}`}
          style={{ background: dotColor }}
        />
        <time className="tl-time">{formatTimestamp(event.timestamp)}</time>
        <EventTypeIcon type={event.event_type} />
        <span className="tl-summary">{summarizeEvent(event)}</span>
        <ChevronRight className={`tl-chevron ${expanded ? "tl-chevron-open" : ""}`} />
      </button>

      {expanded ? <ExpandableDetail event={event} /> : null}
    </div>
  );
}

/* ── Swim-lanes view ───────────────────────────────── */

function SwimLanes({
  events,
  running,
}: {
  events: AgentEvent[];
  running: boolean;
}) {
  const lanes = useMemo(() => {
    const map = new Map<string, AgentEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.source) || [];
      list.push(ev);
      map.set(ev.source, list);
    }
    return map;
  }, [events]);

  // Determine which agents are "active" (started but not completed)
  const activeAgents = useMemo(() => {
    if (!running) return new Set<string>();
    const started = new Set<string>();
    const finished = new Set<string>();
    for (const ev of events) {
      if (ev.event_type === "agent_started") started.add(ev.source);
      if (ev.event_type === "agent_completed" || ev.event_type === "agent_error") finished.add(ev.source);
    }
    return new Set([...started].filter((a) => !finished.has(a)));
  }, [events, running]);

  return (
    <div className="tl-swimlanes">
      {Array.from(lanes.entries()).map(([agentKey, agentEvents]) => {
        const agent = getAgentIdentity(agentKey);
        const isAgentActive = running && activeAgents.has(agentKey);

        return (
          <div key={agentKey} className="tl-lane">
            <div className="tl-lane-header">
              <span className="tl-agent" style={{ color: agent.accent, background: agent.soft }}>
                {agent.displayName}
              </span>
              <span className="tl-lane-count">{agentEvents.length}</span>
              {isAgentActive ? <span className="tl-lane-live" /> : null}
            </div>

            <div className="tl-lane-feed">
              {agentEvents.map((ev, i) => (
                <LaneItem
                  key={`${ev.timestamp}-${i}`}
                  event={ev}
                  isLive={isAgentActive && i === agentEvents.length - 1}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main export ───────────────────────────────────── */

export function ActivityFeed({ events, running, activeAgent, highlightedTask }: ActivityFeedProps) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (event.event_type === "agent_streaming") return false;
      if (activeAgent && event.source !== activeAgent) return false;
      if (typeFilter) return event.event_type === typeFilter;
      if (NOISE_EVENT_TYPES.has(event.event_type)) return false;
      return true;
    });
  }, [activeAgent, events, typeFilter]);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const event of events) {
      if (event.event_type !== "agent_streaming") types.add(event.event_type);
    }
    return Array.from(types);
  }, [events]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Live activity</p>
          <h3 className="section-title mt-2">Timeline and reasoning trail</h3>
        </div>

        <div className="flex items-center gap-2">
          {running ? <span className="live-pill">Streaming</span> : null}

          {/* View mode toggle */}
          <div className="tl-view-toggle">
            <button
              type="button"
              className={`tl-view-btn ${viewMode === "timeline" ? "tl-view-btn-active" : ""}`}
              onClick={() => setViewMode("timeline")}
              title="Timeline view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={`tl-view-btn ${viewMode === "swimlanes" ? "tl-view-btn-active" : ""}`}
              onClick={() => setViewMode("swimlanes")}
              title="Swim-lane view"
            >
              <Columns3 className="h-3.5 w-3.5" />
            </button>
          </div>

          <button type="button" className="secondary-button" onClick={() => setShowFilters((v) => !v)}>
            <Filter className="h-4 w-4" />
            Filters
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <AnimatePresence initial={false}>
        {showFilters ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`filter-pill ${typeFilter === null ? "filter-pill-active" : ""}`}
                onClick={() => setTypeFilter(null)}
              >
                All events
              </button>
              {availableTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`filter-pill ${typeFilter === type ? "filter-pill-active" : ""}`}
                  onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                >
                  {EVENT_LABELS[type] || type}
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Content */}
      {filteredEvents.length > 0 ? (
        viewMode === "timeline" ? (
          <div className="tl-feed">
            {filteredEvents.map((event, index) => (
              <FeedRow
                key={`${event.timestamp}-${event.source}-${index}`}
                event={event}
                highlightedTask={highlightedTask}
                isLive={running && index === filteredEvents.length - 1}
              />
            ))}
          </div>
        ) : (
          <SwimLanes events={filteredEvents} running={running} />
        )
      ) : (
        <div className="workspace-empty px-5 py-10 text-center text-sm leading-7 text-[var(--text-secondary)]">
          {running ? "Connected — waiting for the first event." : "Run a mission to populate the activity timeline."}
        </div>
      )}
    </div>
  );
}
