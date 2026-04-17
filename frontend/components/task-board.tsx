"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { getAgentIdentity } from "@/lib/agent-metadata";
import { TaskItem } from "@/lib/types";

interface TaskBoardProps {
  tasks: TaskItem[];
  running: boolean;
  highlightedTask: number | null;
  onSelectTask: (taskId: number | null) => void;
  embedded?: boolean;
}

function PlaceholderTasks({ running }: { running: boolean }) {
  return (
    <div className="space-y-3">
      {running ? (
        [...Array.from({ length: 3 })].map((_, index) => (
          <div key={index} className="rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3">
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

function TaskList({ tasks, running, highlightedTask, onSelectTask }: TaskBoardProps) {
  if (tasks.length === 0) {
    return <PlaceholderTasks running={running} />;
  }

  return (
    <div className="space-y-2.5">
      {tasks.map((task, index) => {
        const agent = getAgentIdentity(task.assigned_to);
        const isActive = highlightedTask === task.id;

        return (
          <motion.button
            key={task.id}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, delay: index * 0.02 }}
            onClick={() => onSelectTask(isActive ? null : task.id)}
            aria-pressed={isActive}
            className={`task-card ${isActive ? "task-card-active" : ""}`}
            style={{
              borderColor: task.finished ? "var(--success-soft)" : agent.border,
              background: task.finished ? "var(--success-soft)" : "var(--surface-soft)",
            }}
          >
            <span className={`task-marker ${task.finished ? "task-marker-done" : ""}`}>
              {task.finished ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : task.id}
            </span>
            <div className="min-w-0 flex-1 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[11px] font-medium"
                  style={{ color: agent.accent, background: agent.soft }}
                >
                  <agent.icon className="h-3 w-3" strokeWidth={2} />
                  {agent.displayName}
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {task.finished ? "completed" : "in progress"}
                </span>
              </div>
              <p className={`mt-1.5 text-[13px] leading-[1.55] ${task.finished ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}`}>
                {task.text}
              </p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

export function TaskBoard({ tasks, running, highlightedTask, onSelectTask, embedded = false }: TaskBoardProps) {
  const [collapsed, setCollapsed] = useState(true);
  const completed = tasks.filter((task) => task.finished).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  if (embedded) {
    return (
      <div role="tabpanel" id="workspace-panel-tasks" className="space-y-4">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] pb-3">
          <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <span className="font-mono tabular-nums text-[var(--text-primary)]">{completed}/{tasks.length || 0}</span>
            <span className="text-[var(--text-muted)]">tasks complete</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 w-40 overflow-hidden rounded-full bg-[var(--surface-soft)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono tabular-nums text-xs text-[var(--text-muted)]">{progress}%</span>
          </div>
        </div>
        <TaskList
          tasks={tasks}
          running={running}
          highlightedTask={highlightedTask}
          onSelectTask={onSelectTask}
        />
      </div>
    );
  }

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
    <section className="panel-shell flex w-full flex-col overflow-hidden p-4 sm:p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Task board</p>
          <h2 className="section-title mt-2">Dispatch progress</h2>
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
        <TaskList
          tasks={tasks}
          running={running}
          highlightedTask={highlightedTask}
          onSelectTask={onSelectTask}
        />
      </div>
    </section>
  );
}
