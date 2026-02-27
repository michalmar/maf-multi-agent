import React from 'react';

/**
 * Derive each agent's activity status from the event stream.
 *  - idle: no events yet or workflow hasn't started
 *  - working: agent_started seen but no agent_completed/agent_error yet
 *  - done: agent_completed seen
 *  - error: agent_error seen
 *
 * The orchestrator is "working" from workflow_started until workflow_completed.
 */
function deriveAgentStatuses(agents, events, workflowStatus) {
  const statuses = {};

  for (const a of agents) {
    statuses[a.name] = 'idle';
  }

  // Orchestrator tracks the overall workflow
  if (workflowStatus === 'running') statuses['orchestrator'] = 'working';
  if (workflowStatus === 'done') statuses['orchestrator'] = 'done';
  if (workflowStatus === 'error') statuses['orchestrator'] = 'error';

  for (const evt of events) {
    const src = evt.source;
    if (!statuses.hasOwnProperty(src)) continue;

    if (evt.event_type === 'agent_started') {
      statuses[src] = 'working';
    } else if (evt.event_type === 'agent_completed') {
      statuses[src] = 'done';
    } else if (evt.event_type === 'agent_error') {
      statuses[src] = 'error';
    }
  }

  return statuses;
}

const STATUS_RING = {
  idle: 'ring-gray-700',
  working: 'ring-blue-500 animate-pulse',
  done: 'ring-emerald-500',
  error: 'ring-red-500',
};

const STATUS_BG = {
  idle: 'bg-gray-800/60',
  working: 'bg-blue-950/40',
  done: 'bg-emerald-950/30',
  error: 'bg-red-950/30',
};

const STATUS_BADGE_COLOR = {
  idle: 'bg-gray-600',
  working: 'bg-blue-500 animate-pulse',
  done: 'bg-emerald-500',
  error: 'bg-red-500',
};

const STATUS_LABEL = {
  idle: 'Idle',
  working: 'Working',
  done: 'Done',
  error: 'Error',
};

export default function AgentRoster({ agents, events, workflowStatus }) {
  if (!agents || agents.length === 0) return null;

  const statuses = deriveAgentStatuses(agents, events, workflowStatus);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4 uppercase tracking-wider">Agent Team</h2>
      <div className="flex flex-wrap gap-4">
        {agents.map((agent) => {
          const st = statuses[agent.name] || 'idle';
          return (
            <div
              key={agent.name}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-700/50 transition-all duration-300 ${STATUS_BG[st]}`}
            >
              {/* Avatar circle */}
              <div className={`relative w-12 h-12 rounded-full ring-2 ${STATUS_RING[st]} flex items-center justify-center bg-gray-800 text-2xl transition-all duration-300`}>
                {agent.avatar}
                {/* Status dot */}
                <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-gray-900 ${STATUS_BADGE_COLOR[st]}`} />
              </div>

              {/* Info */}
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-100 truncate">{agent.display_name}</div>
                <div className="text-xs text-gray-500 truncate">{agent.role}</div>
                <div className={`text-[10px] font-medium uppercase tracking-wide mt-0.5 ${
                  st === 'idle' ? 'text-gray-500' :
                  st === 'working' ? 'text-blue-400' :
                  st === 'done' ? 'text-emerald-400' :
                  'text-red-400'
                }`}>
                  {STATUS_LABEL[st]}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
