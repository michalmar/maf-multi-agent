"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { getAgentIdentity } from "@/lib/agent-metadata";
import { TaskItem } from "@/lib/types";

interface TaskBoardProps {
  tasks: TaskItem[];
  running: boolean;
  highlightedTask: number | null;
  panelHeight?: number | null;
  onSelectTask: (taskId: number | null) => void;
}

function PlaceholderTasks({ running }: { running: boolean }) {
  return (
    <div className="space-y-3">
      {running ? (
        [...Array.from({ length: 3 })].map((_, index) => (
          <div key={index} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3">
            <div className="skeleton-line h-3 w-24" />
            <div className="skeleton-line mt-3 h-4 w-full" />
            <div className="skeleton-line mt-2 h-4 w-4/5" />
          </div>
        ))
      ) : (
        <div className="workspace-empty px-5 py-8 text-sm leading-7 text-[var(--text-secondary)]">
          Tasks will settle here as soon as the orchestrator starts breaking the request into specialist work.
        </div>
      )}
    </div>
  );
}

export function TaskBoard({ tasks, running, highlightedTask, panelHeight, onSelectTask }: TaskBoardProps) {
  const [collapsed, setCollapsed] = useState(true);
  const completed = tasks.filter((task) => task.finished).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  if (collapsed) {
    return (
      <section className="panel-shell flex w-full items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <p className="eyebrow">Task board</p>
          <div className="mt-2 flex min-w-0 items-center gap-3">
            <h2 className="truncate text-lg font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Dispatch progress</h2>
            <span className="truncate text-xs uppercase tracking-[0.22em] text-[var(--text-muted)]">
              {completed}/{tasks.length || 0} complete
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="progress-badge progress-badge-compact" style={{ ["--progress" as string]: `${progress}%` }}>
            <div className="progress-badge-inner">
              <span className="font-mono text-lg text-[var(--text-primary)]">{progress}%</span>
              <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{tasks.length}</span>
            </div>
          </div>

          <button
            type="button"
            title="Expand task board"
            aria-label="Expand task board"
            className="secondary-button !rounded-full !px-3 !py-3"
            onClick={() => setCollapsed(false)}
          >
            <ChevronDown className="h-4 w-4 rotate-180" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="panel-shell flex w-full flex-col overflow-hidden p-4 sm:p-5"
      style={panelHeight ? { height: `${panelHeight}px` } : undefined}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Task board</p>
          <h2 className="section-title mt-2">Dispatch progress</h2>
          <p className="section-copy mt-2 max-w-sm">
            The compact progress tracker is still here, just with a more polished operational card treatment.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="progress-badge" style={{ ["--progress" as string]: `${progress}%` }}>
            <div className="progress-badge-inner">
              <span className="font-mono text-lg text-[var(--text-primary)]">{progress}%</span>
              <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
                {completed}/{tasks.length || 0}
              </span>
            </div>
          </div>

          <button
            type="button"
            title="Collapse task board"
            aria-label="Collapse task board"
            className="secondary-button !rounded-full !px-3 !py-3"
            onClick={() => setCollapsed(true)}
          >
            <ChevronDown className="h-4 w-4 -rotate-90" />
          </button>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {tasks.length === 0 ? (
          <PlaceholderTasks running={running} />
        ) : (
          <div className="space-y-3">
            {tasks.map((task, index) => {
              const agent = getAgentIdentity(task.assigned_to);
              const isActive = highlightedTask === task.id;

              return (
                <motion.button
                  key={task.id}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  onClick={() => onSelectTask(isActive ? null : task.id)}
                  className={`task-card ${isActive ? "task-card-active" : ""}`}
                  style={{
                    borderColor: task.finished ? "rgba(101, 146, 121, 0.34)" : agent.border,
                    background: task.finished ? "rgba(101, 146, 121, 0.12)" : "var(--surface-soft)",
                  }}
                >
                  <span className={`task-marker ${task.finished ? "task-marker-done" : ""}`}>{task.finished ? "✓" : task.id}</span>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]"
                        style={{ color: agent.accent, background: agent.soft }}
                      >
                        {agent.displayName}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
                        {task.finished ? "completed" : "awaiting completion"}
                      </span>
                    </div>
                    <p className={`mt-2 text-sm leading-6 ${task.finished ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}`}>
                      {task.text}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
