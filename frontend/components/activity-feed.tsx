"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Filter } from "lucide-react";
import { getAgentIdentity } from "@/lib/agent-metadata";
import { AgentEvent } from "@/lib/types";

interface ActivityFeedProps {
  events: AgentEvent[];
  running: boolean;
  activeAgent: string | null;
  highlightedTask: number | null;
}

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

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function summarizeEvent(event: AgentEvent) {
  const { event_type: type, data } = event;

  if (type === "reasoning") {
    return data.text || "No reasoning text provided.";
  }
  if (type === "tool_decision") {
    return data.tool ? `Preparing ${String(data.tool)}` : "Tool decision recorded.";
  }
  if (type === "tasks_created") {
    return `${Array.isArray(data.tasks) ? data.tasks.length : 0} tasks drafted for dispatch.`;
  }
  if (type === "task_completed") {
    return `Task #${String(data.task_id ?? "?")} marked complete.`;
  }
  if (type === "agent_started") {
    return `${String(data.agent_name ?? event.source)} is now working.`;
  }
  if (type === "agent_completed") {
    const duration = typeof data.elapsed === "number" ? `${data.elapsed.toFixed(1)}s` : "unknown duration";
    return `Completed in ${duration}${typeof data.length === "number" ? ` • ${data.length} chars` : ""}`;
  }
  if (type === "document_updated") {
    return `Document version ${String(data.version ?? "?")} recorded.`;
  }
  if (type === "output") {
    return data.text ? String(data.text).slice(0, 120) : "Final output streamed.";
  }
  if (type === "agent_error") {
    return data.error ? String(data.error) : "The backend reported an error.";
  }
  if (type === "workflow_started") {
    return data.query ? String(data.query).slice(0, 120) : "Mission received.";
  }
  if (type === "workflow_completed") {
    return typeof data.elapsed === "number" ? `Workflow completed in ${data.elapsed.toFixed(1)}s.` : "Workflow completed.";
  }

  return JSON.stringify(data);
}

function prettifyData(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function EventDetail({ event }: { event: AgentEvent }) {
  const { event_type: type, data } = event;

  if (type === "tasks_created" && Array.isArray(data.tasks)) {
    return (
      <div className="space-y-2 text-sm text-[var(--text-secondary)]">
        {data.tasks.map((task) => (
          <div key={task.id} className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2">
            <span className="font-mono text-xs text-[var(--text-muted)]">#{task.id}</span>
            <p className="mt-1 text-[var(--text-primary)]">{task.text}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[var(--text-muted)]">{task.assigned_to}</p>
          </div>
        ))}
      </div>
    );
  }

  if (type === "reasoning" && typeof data.text === "string") {
    return <pre className="feed-pre">{data.text}</pre>;
  }
  if (type === "document_updated" && typeof data.content === "string") {
    return <pre className="feed-pre">{data.content}</pre>;
  }
  if (type === "agent_completed" && typeof data.result === "string") {
    return <pre className="feed-pre">{data.result}</pre>;
  }

  return <pre className="feed-pre">{prettifyData(data)}</pre>;
}

function FeedRow({ event, highlightedTask }: { event: AgentEvent; highlightedTask: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const agent = getAgentIdentity(event.source);
  const isTaskRelated =
    highlightedTask !== null &&
    ((event.event_type === "task_completed" && event.data.task_id === highlightedTask) ||
      (event.event_type === "agent_started" && event.data.task_id === highlightedTask) ||
      (event.event_type === "tasks_created" &&
        Array.isArray(event.data.tasks) &&
        event.data.tasks.some((task) => task.id === highlightedTask)));

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`timeline-row ${isTaskRelated ? "timeline-row-active" : ""}`}
      style={{ borderColor: agent.border }}
    >
      <button type="button" className="w-full text-left" onClick={() => setExpanded((current) => !current)}>
        <div className="flex items-start gap-3">
          <div className="timeline-agent-chip" style={{ borderColor: agent.border, color: agent.accent, background: agent.soft }}>
            <span className="timeline-agent-avatar">{agent.avatar}</span>
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
              <span>{formatTimestamp(event.timestamp)}</span>
              <span className="rounded-full px-2 py-1" style={{ color: agent.accent, background: agent.soft }}>
                {agent.displayName}
              </span>
              <span>{EVENT_LABELS[event.event_type] || event.event_type}</span>
            </div>
            <p className="text-sm leading-6 text-[var(--text-primary)]">{summarizeEvent(event)}</p>
          </div>

          <ChevronDown
            className={`mt-1 h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-[var(--border-soft)] pt-4">
              <EventDetail event={event} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}

export function ActivityFeed({ events, running, activeAgent, highlightedTask }: ActivityFeedProps) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (event.event_type === "agent_streaming") {
        return false;
      }
      if (activeAgent && event.source !== activeAgent) {
        return false;
      }
      if (typeFilter && event.event_type !== typeFilter) {
        return false;
      }
      return true;
    });
  }, [activeAgent, events, typeFilter]);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const event of events) {
      if (event.event_type !== "agent_streaming") {
        types.add(event.event_type);
      }
    }
    return Array.from(types);
  }, [events]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Live activity</p>
          <h3 className="section-title mt-2">Timeline and reasoning trail</h3>
          <p className="section-copy mt-2 max-w-2xl">
            Filterable event history with the same payload detail, now styled like a cleaner product analytics surface.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {running ? <span className="live-pill">Streaming</span> : null}
          <button type="button" className="secondary-button" onClick={() => setShowFilters((current) => !current)}>
            <Filter className="h-4 w-4" />
            Filters
          </button>
        </div>
      </div>

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

      <div className="space-y-3">
        {filteredEvents.length > 0 ? (
          filteredEvents.map((event, index) => (
            <FeedRow key={`${event.timestamp}-${event.source}-${index}`} event={event} highlightedTask={highlightedTask} />
          ))
        ) : (
          <div className="workspace-empty px-5 py-10 text-center text-sm leading-7 text-[var(--text-secondary)]">
            {running ? "The panel is connected and waiting for the first stream event." : "Run a mission to populate the activity timeline."}
          </div>
        )}
      </div>
    </div>
  );
}
