import React, { useState, useRef, useEffect } from 'react';

const ICONS = {
  orchestrator: '🤖',
  flights_tool: '✈️',
  hotels_tool: '🏨',
  taskboard: '📋',
  document: '📝',
  websearch_tool: '🔍',
};

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

const TYPE_COLORS = {
  reasoning: 'border-purple-700/50 bg-purple-950/30',
  tool_decision: 'border-amber-700/50 bg-amber-950/30',
  agent_started: 'border-blue-700/50 bg-blue-950/30',
  agent_completed: 'border-emerald-700/50 bg-emerald-950/30',
  agent_error: 'border-red-700/50 bg-red-950/30',
  agent_streaming: 'border-gray-700/30 bg-gray-900/30',
  workflow_started: 'border-cyan-700/50 bg-cyan-950/30',
  workflow_completed: 'border-cyan-700/50 bg-cyan-950/30',
  tasks_created: 'border-indigo-700/50 bg-indigo-950/30',
  task_completed: 'border-emerald-700/50 bg-emerald-950/30',
  document_updated: 'border-teal-700/50 bg-teal-950/30',
  output: 'border-green-700/50 bg-green-950/30',
};

const DOT_COLORS = {
  reasoning: 'bg-purple-400',
  tool_decision: 'bg-amber-400',
  agent_started: 'bg-blue-400',
  agent_completed: 'bg-emerald-400',
  agent_error: 'bg-red-400',
  agent_streaming: 'bg-gray-500',
  workflow_started: 'bg-cyan-400',
  workflow_completed: 'bg-cyan-400',
  tasks_created: 'bg-indigo-400',
  task_completed: 'bg-emerald-400',
  document_updated: 'bg-teal-400',
  output: 'bg-green-400',
};

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour12: false });
}

function EventSummary({ evt }) {
  const t = evt.event_type;
  const d = evt.data;

  if (t === 'reasoning') {
    const text = d.text || '';
    return <span className="text-purple-300">{text.substring(0, 150)}{text.length > 150 ? '…' : ''}</span>;
  }
  if (t === 'tool_decision') return <span className="text-amber-300">→ {d.tool || '?'}</span>;
  if (t === 'agent_started') return <span className="text-blue-300">Starting: {d.agent_name || '?'}</span>;
  if (t === 'agent_completed') return <span className="text-emerald-300">✓ {d.length || 0} chars in {(d.elapsed || 0).toFixed(1)}s</span>;
  if (t === 'agent_error') return <span className="text-red-300">✕ {d.error || 'Unknown error'}</span>;
  if (t === 'agent_streaming') return <span className="text-gray-400 font-mono text-xs">{(d.delta || '').substring(0, 80)}</span>;
  if (t === 'workflow_started') return <span className="text-cyan-300">Query: {(d.query || '').substring(0, 100)}</span>;
  if (t === 'workflow_completed') return <span className="text-cyan-300">Done in {(d.elapsed || 0).toFixed(1)}s</span>;
  if (t === 'tasks_created') return <span className="text-indigo-300">{(d.tasks || []).length} tasks</span>;
  if (t === 'task_completed') return <span className="text-emerald-300">Task #{d.task_id} done</span>;
  if (t === 'document_updated') return <span className="text-teal-300">v{d.version}</span>;
  if (t === 'output') return <span className="text-green-300">{(d.text || '').substring(0, 100)}…</span>;
  return null;
}

function EventDetail({ evt }) {
  const t = evt.event_type;
  const d = evt.data;

  if (t === 'reasoning') return <pre className="text-sm text-gray-300 whitespace-pre-wrap">{d.text}</pre>;
  if (t === 'agent_streaming') return <pre className="text-sm text-gray-400 font-mono whitespace-pre-wrap">{d.delta}</pre>;
  if (t === 'tasks_created') return (
    <div className="space-y-1">
      {(d.tasks || []).map((task) => (
        <div key={task.id} className="text-sm text-gray-300 flex gap-2">
          <span className="text-gray-500 w-6 text-right">#{task.id}</span>
          <span className="text-blue-400">[{task.assigned_to}]</span>
          <span>{task.text}</span>
        </div>
      ))}
    </div>
  );
  if (t === 'agent_completed') return <pre className="text-sm text-gray-300 whitespace-pre-wrap max-h-60 overflow-auto">{d.result || `Completed: ${d.length} chars in ${(d.elapsed||0).toFixed(1)}s`}</pre>;
  if (t === 'document_updated') return <pre className="text-sm text-gray-300 whitespace-pre-wrap max-h-60 overflow-auto">{d.content}</pre>;
  return <pre className="text-sm text-gray-400">{JSON.stringify(d, null, 2)}</pre>;
}

function EventCard({ evt, index }) {
  const [open, setOpen] = useState(false);
  // Auto-collapse streaming events
  const isMinor = evt.event_type === 'agent_streaming';
  const colorClass = TYPE_COLORS[evt.event_type] || 'border-gray-700/50 bg-gray-900/30';
  const dotColor = DOT_COLORS[evt.event_type] || 'bg-gray-400';

  if (isMinor) return null; // Skip streaming deltas — too noisy for UI

  return (
    <div className={`border rounded-lg ${colorClass} transition-all`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-lg shrink-0">{ICONS[evt.source] || '⚡'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">{formatTime(evt.timestamp)}</span>
            <span className="text-xs font-medium text-gray-400">{TYPE_LABELS[evt.event_type] || evt.event_type}</span>
            <span className="text-xs text-gray-600">· {evt.source}</span>
          </div>
          <div className="mt-0.5 text-sm truncate">
            <EventSummary evt={evt} />
          </div>
        </div>
        <svg className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-white/5">
          <EventDetail evt={evt} />
        </div>
      )}
    </div>
  );
}

export default function EventStream({ events, running }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const HIDDEN_TYPES = new Set(['agent_streaming', 'tool_decision', 'task_completed']);
  const displayed = events.filter((e) => !HIDDEN_TYPES.has(e.event_type));

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span>📡</span> Activity Stream
        {running && (
          <span className="ml-2 inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
        )}
        <span className="ml-auto text-xs text-gray-500 font-normal">{displayed.length} events</span>
      </h2>
      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        {displayed.length === 0 && running && (
          <div className="text-center text-gray-500 py-8 text-sm">Waiting for events...</div>
        )}
        {displayed.map((evt, i) => (
          <EventCard key={i} evt={evt} index={i} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
