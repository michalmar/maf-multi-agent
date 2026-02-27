import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Filter, Radio } from 'lucide-react';
import { getAgentConfig } from '../agentConfig';

const TYPE_LABELS = {
  workflow_started: 'Workflow Started',
  workflow_completed: 'Workflow Completed',
  reasoning: 'Reasoning',
  tool_decision: 'Tool Decision',
  output: 'Output',
  tasks_created: 'Tasks Created',
  task_completed: 'Task Completed',
  agent_started: 'Agent Started',
  agent_streaming: 'Streaming',
  agent_completed: 'Agent Completed',
  agent_error: 'Error',
  document_updated: 'Document Updated',
};

const TYPE_ICONS = {
  reasoning: '💭',
  tool_decision: '🔧',
  agent_started: '▶',
  agent_completed: '✓',
  agent_error: '✕',
  workflow_started: '🚀',
  workflow_completed: '🏁',
  tasks_created: '📋',
  task_completed: '✅',
  document_updated: '📝',
  output: '💬',
};

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour12: false });
}

function EventSummary({ evt }) {
  const t = evt.event_type;
  const d = evt.data;

  if (t === 'reasoning') {
    const text = d.text || '';
    return <span className="opacity-80">{text.substring(0, 120)}{text.length > 120 ? '…' : ''}</span>;
  }
  if (t === 'tool_decision') return <span>→ <span className="font-medium">{d.tool || '?'}</span></span>;
  if (t === 'agent_started') return <span>Starting: {d.agent_name || '?'}</span>;
  if (t === 'agent_completed') return <span>✓ {d.length || 0} chars in {(d.elapsed || 0).toFixed(1)}s</span>;
  if (t === 'agent_error') return <span className="text-red-400">✕ {d.error || 'Unknown error'}</span>;
  if (t === 'workflow_started') return <span>Query: {(d.query || '').substring(0, 80)}</span>;
  if (t === 'workflow_completed') return <span>Done in {(d.elapsed || 0).toFixed(1)}s</span>;
  if (t === 'tasks_created') return <span>{(d.tasks || []).length} tasks planned</span>;
  if (t === 'task_completed') return <span>Task #{d.task_id} done</span>;
  if (t === 'document_updated') return <span>v{d.version}</span>;
  if (t === 'output') return <span>{(d.text || '').substring(0, 80)}…</span>;
  return null;
}

function EventDetail({ evt }) {
  const t = evt.event_type;
  const d = evt.data;

  if (t === 'reasoning') return <pre className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{d.text}</pre>;
  if (t === 'tasks_created') return (
    <div className="space-y-1.5">
      {(d.tasks || []).map((task) => {
        const cfg = getAgentConfig(task.assigned_to);
        return (
          <div key={task.id} className="text-sm flex gap-2 items-start">
            <span style={{ color: 'var(--text-muted)' }} className="w-6 text-right shrink-0">#{task.id}</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0" style={{ color: cfg.color, background: `color-mix(in srgb, ${cfg.color} 15%, transparent)` }}>
              {cfg.name}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>{task.text}</span>
          </div>
        );
      })}
    </div>
  );
  if (t === 'agent_completed') return <pre className="text-sm whitespace-pre-wrap max-h-60 overflow-auto" style={{ color: 'var(--text-secondary)' }}>{d.result || `Completed: ${d.length} chars`}</pre>;
  if (t === 'document_updated') return <pre className="text-sm whitespace-pre-wrap max-h-60 overflow-auto" style={{ color: 'var(--text-secondary)' }}>{d.content}</pre>;
  if (t === 'tool_decision') return <pre className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{JSON.stringify(d.arguments || d, null, 2)}</pre>;
  return <pre className="text-sm" style={{ color: 'var(--text-muted)' }}>{JSON.stringify(d, null, 2)}</pre>;
}

function EventCard({ evt, highlightedTask }) {
  const [open, setOpen] = useState(false);
  if (evt.event_type === 'agent_streaming') return null;

  const cfg = getAgentConfig(evt.source);
  const isTaskRelated = highlightedTask && (
    (evt.event_type === 'tasks_created') ||
    (evt.event_type === 'task_completed' && evt.data.task_id === highlightedTask) ||
    (evt.event_type === 'agent_started' && evt.data.task_id === highlightedTask)
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
      className={`group relative pl-10 ${isTaskRelated ? 'ring-1 ring-blue-500/30 rounded-lg' : ''}`}
    >
      {/* Timeline dot */}
      <div
        className="absolute left-0 top-3 w-6 h-6 rounded-full flex items-center justify-center text-xs border-2"
        style={{
          borderColor: cfg.color,
          background: `color-mix(in srgb, ${cfg.color} 10%, var(--bg-surface))`,
        }}
      >
        <span className="text-sm">{cfg.icon}</span>
      </div>

      {/* Card */}
      <div
        className="rounded-lg border transition-all duration-200 hover:border-opacity-60"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
          borderLeftColor: cfg.color,
          borderLeftWidth: '2px',
        }}
      >
        <button
          onClick={() => setOpen(!open)}
          className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-white/[0.02] transition-colors rounded-lg"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--text-muted)' }}>{formatTime(evt.timestamp)}</span>
              <span
                className="font-medium px-1.5 py-0.5 rounded"
                style={{ color: cfg.color, background: `color-mix(in srgb, ${cfg.color} 8%, transparent)` }}
              >
                {cfg.name}
              </span>
              <span className="opacity-60" style={{ color: 'var(--text-muted)' }}>
                {TYPE_LABELS[evt.event_type] || evt.event_type}
              </span>
            </div>
            <div className="mt-1 text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
              <EventSummary evt={evt} />
            </div>
          </div>
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            style={{ color: 'var(--text-muted)' }}
          />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <EventDetail evt={evt} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default function EventStream({ events, running, activeAgent, highlightedTask, embedded }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const [isPaused, setIsPaused] = useState(false);
  const [typeFilter, setTypeFilter] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!isPaused) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, isPaused]);

  const displayed = useMemo(() => {
    return events.filter((e) => {
      if (e.event_type === 'agent_streaming' || e.event_type === 'tool_decision' || e.event_type === 'task_completed') return false;
      if (activeAgent && e.source !== activeAgent) return false;
      if (typeFilter && e.event_type !== typeFilter) return false;
      return true;
    });
  }, [events, activeAgent, typeFilter]);

  const eventTypes = useMemo(() => {
    const types = new Set(events.filter(e => e.event_type !== 'agent_streaming').map(e => e.event_type));
    return Array.from(types);
  }, [events]);

  return (
    <div className={embedded ? 'flex flex-col' : 'glass rounded-2xl p-5 flex flex-col'} style={{ minHeight: embedded ? '350px' : '400px' }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        {!embedded && <Radio size={16} style={{ color: 'var(--color-active)' }} />}
        {!embedded && <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Activity Stream</h2>}
        {running && (
          <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--color-active)' }} />
        )}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{displayed.length} events</span>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-1.5 rounded-md transition-colors ${showFilters ? 'bg-white/10' : 'hover:bg-white/5'}`}
        >
          <Filter size={13} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {/* Filter bar */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-3"
          >
            <div className="flex flex-wrap gap-1.5 pb-2">
              <button
                onClick={() => setTypeFilter(null)}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${!typeFilter ? 'bg-white/10 text-white' : 'bg-white/5 hover:bg-white/8'}`}
                style={typeFilter ? { color: 'var(--text-muted)' } : {}}
              >
                All
              </button>
              {eventTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${typeFilter === t ? 'bg-white/10 text-white' : 'bg-white/5 hover:bg-white/8'}`}
                  style={typeFilter !== t ? { color: 'var(--text-muted)' } : {}}
                >
                  {TYPE_LABELS[t] || t}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto pr-1 space-y-2 relative"
        style={{ maxHeight: '550px' }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {/* Timeline line */}
        <div
          className="absolute left-3 top-0 bottom-0 w-px"
          style={{ background: 'var(--border-subtle)' }}
        />

        {displayed.length === 0 && running && (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
            Waiting for events...
          </div>
        )}

        {displayed.map((evt, i) => (
          <EventCard key={`${evt.timestamp}-${i}`} evt={evt} highlightedTask={highlightedTask} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Paused indicator */}
      {isPaused && running && displayed.length > 0 && (
        <div className="text-center mt-2">
          <span className="text-xs px-2 py-1 rounded-md bg-white/5" style={{ color: 'var(--text-muted)' }}>
            Auto-scroll paused · hover out to resume
          </span>
        </div>
      )}
    </div>
  );
}
