import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ListChecks } from 'lucide-react';
import { getAgentConfig } from '../agentConfig';

// SVG circular progress ring
function ProgressRing({ progress, size = 52, strokeWidth = 4 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      {/* Background ring */}
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth={strokeWidth} />
      {/* Progress ring */}
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-success)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </svg>
  );
}

export default function TaskPanel({ tasks, onTaskClick, highlightedTask }) {
  if (tasks.length === 0) return null;

  const total = tasks.length;
  const done = tasks.filter((t) => t.finished).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="panel rounded-xl p-5 h-full overflow-y-auto">
      {/* Header with progress ring */}
      <div className="flex items-center gap-3 mb-4">
        <ProgressRing progress={pct} />
        <div>
          <h2 className="text-xs font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ListChecks size={14} />
            Tasks
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {done} of {total} completed
          </p>
        </div>
        <span
          className="ml-auto text-lg font-bold tabular-nums"
          style={{ color: pct === 100 ? 'var(--color-success)' : 'var(--text-secondary)' }}
        >
          {pct}%
        </span>
      </div>

      {/* Task list */}
      <div className="space-y-1.5">
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => {
            const cfg = getAgentConfig(task.assigned_to);
            const isHighlighted = highlightedTask === task.id;

            return (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25 }}
                onClick={() => onTaskClick?.(isHighlighted ? null : task.id)}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all duration-200 border ${
                  isHighlighted ? 'ring-1 ring-blue-500/40' : ''
                }`}
                style={{
                  background: task.finished
                    ? 'color-mix(in srgb, var(--color-success) 6%, var(--bg-surface))'
                    : 'var(--bg-surface)',
                  borderColor: task.finished
                    ? 'color-mix(in srgb, var(--color-success) 15%, transparent)'
                    : 'var(--border-subtle)',
                }}
              >
                {/* Animated checkmark */}
                <span className="mt-0.5 shrink-0">
                  {task.finished ? (
                    <motion.svg
                      width="16" height="16" viewBox="0 0 16 16"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                    >
                      <circle cx="8" cy="8" r="7" fill="var(--color-success)" opacity="0.15" />
                      <motion.path
                        d="M4.5 8.5L7 11L11.5 5.5"
                        fill="none"
                        stroke="var(--color-success)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, delay: 0.1 }}
                      />
                    </motion.svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="7" fill="none" stroke="var(--border-accent)" strokeWidth="1" strokeDasharray="3 2" />
                    </svg>
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>#{task.id}</span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{
                        color: cfg.color,
                        background: `color-mix(in srgb, ${cfg.color} 12%, transparent)`,
                      }}
                    >
                      {cfg.icon} {cfg.name}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 text-xs leading-relaxed ${task.finished ? 'line-through opacity-60' : ''}`}
                    style={{ color: task.finished ? 'var(--text-muted)' : 'var(--text-secondary)' }}
                  >
                    {task.text}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
