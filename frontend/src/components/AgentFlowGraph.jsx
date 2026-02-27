import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AGENT_COLORS_HEX, getAgentConfig } from '../agentConfig';

// Card dimensions for foreignObject — horizontal people card
const CARD_W = 150;
const CARD_H = 48;

function getNodePositions(agentKeys, width, height) {
  const cx = width / 2;
  const topY = CARD_H / 2 + 8;
  const botY = height - CARD_H / 2 - 8;
  const positions = { orchestrator: { x: cx, y: topY } };

  const agents = agentKeys.filter((k) => k !== 'orchestrator');
  const totalW = agents.length * CARD_W + (agents.length - 1) * 20;
  const startX = cx - totalW / 2 + CARD_W / 2;
  agents.forEach((key, i) => {
    positions[key] = { x: startX + i * (CARD_W + 20), y: botY };
  });
  return positions;
}

function deriveStatuses(events, workflowStatus) {
  const statuses = { orchestrator: 'idle' };
  if (workflowStatus === 'running') statuses.orchestrator = 'working';
  if (workflowStatus === 'done') statuses.orchestrator = 'done';
  if (workflowStatus === 'error') statuses.orchestrator = 'error';

  for (const evt of events) {
    const src = evt.source;
    if (evt.event_type === 'agent_started') statuses[src] = 'working';
    else if (evt.event_type === 'agent_completed') statuses[src] = 'done';
    else if (evt.event_type === 'agent_error') statuses[src] = 'error';
  }
  return statuses;
}

const STATUS_BADGE = {
  idle:    { label: 'Idle',    color: 'var(--text-muted)', border: 'var(--border-subtle)' },
  working: { label: 'Running', color: '#3B82F6',           border: '#3B82F6' },
  done:    { label: 'Done',    color: '#10B981',           border: '#10B981' },
  error:   { label: 'Error',   color: '#EF4444',           border: '#EF4444' },
};

function AgentCard({ agentKey, agentData, pos, status, isActive, onClick }) {
  const cfg = getAgentConfig(agentKey);
  const hex = AGENT_COLORS_HEX[agentKey] || '#818CF8';
  const isWorking = status === 'working';
  const badge = STATUS_BADGE[status] || STATUS_BADGE.idle;
  const model = agentData?.model || '';

  const left = pos.x - CARD_W / 2;
  const top = pos.y - CARD_H / 2;

  return (
    <g onClick={() => onClick(agentKey)} className="cursor-pointer" role="button" tabIndex={0}>
      <foreignObject x={left} y={top} width={CARD_W} height={CARD_H}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: CARD_W,
            height: CARD_H,
            background: isActive ? `color-mix(in srgb, ${hex} 8%, var(--bg-surface))` : 'var(--bg-surface)',
            border: `1px solid ${isActive ? hex : status !== 'idle' ? hex : 'var(--border-subtle)'}`,
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: '0 10px',
            position: 'relative',
            overflow: 'hidden',
            transition: 'border-color 0.3s, background 0.3s',
          }}
        >
          {/* Avatar with spinner ring */}
          <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
            {isWorking && (
              <svg
                width={32} height={32}
                style={{
                  position: 'absolute', top: -2, left: -2,
                  animation: 'spin-ring 1.2s linear infinite',
                }}
              >
                <circle cx={16} cy={16} r={14} fill="none" stroke={hex} strokeWidth={2} strokeDasharray="26 62" strokeLinecap="round" opacity={0.8} />
              </svg>
            )}
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14,
              background: `color-mix(in srgb, ${hex} 12%, transparent)`,
              border: `1.5px solid ${status !== 'idle' ? hex : 'var(--border-subtle)'}`,
              transition: 'border-color 0.3s',
            }}>
              {cfg.icon}
            </div>
          </div>

          {/* Name + model + badge */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-primary)',
                lineHeight: 1.2, fontFamily: 'system-ui, sans-serif',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {cfg.name}
              </span>
              {/* Inline tiny badge */}
              <span style={{
                fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                padding: '0px 4px', borderRadius: 4, lineHeight: '12px', flexShrink: 0,
                background: `color-mix(in srgb, ${badge.color} 12%, transparent)`,
                color: badge.color,
              }}>
                {isWorking && (
                  <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: badge.color, marginRight: 2, verticalAlign: 'middle', animation: 'pulse-dot 1s ease-in-out infinite' }} />
                )}
                {badge.label}
              </span>
            </div>
            {model && (
              <div style={{
                fontSize: 8, color: 'var(--text-muted)',
                fontFamily: 'system-ui, sans-serif',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.3, marginTop: 1,
              }}>
                {model}
              </div>
            )}
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

function ConnectionPath({ from, to, isActive, isDone, color }) {
  const fromY = from.y + CARD_H / 2;
  const toY = to.y - CARD_H / 2;
  const midY = (fromY + toY) / 2;
  const d = `M ${from.x} ${fromY} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${toY}`;

  return (
    <>
      <path d={d} fill="none" stroke={isDone ? color : 'var(--border-subtle)'} strokeWidth={1.5} opacity={isDone ? 0.3 : 0.4} />
      {isActive && (
        <path d={d} fill="none" stroke={color} strokeWidth={2} className="path-flow" opacity={0.7} />
      )}
    </>
  );
}

export default function AgentFlowGraph({ agents, events, workflowStatus, activeAgent, onAgentClick }) {
  const agentKeys = useMemo(() => {
    const keys = ['orchestrator'];
    if (agents) {
      agents.forEach((a) => { if (a.name !== 'orchestrator') keys.push(a.name); });
    }
    return keys;
  }, [agents]);

  const agentMap = useMemo(() => {
    const m = {};
    if (agents) agents.forEach((a) => { m[a.name] = a; });
    return m;
  }, [agents]);

  const statuses = useMemo(() => deriveStatuses(events, workflowStatus), [events, workflowStatus]);

  const childKeys = agentKeys.filter((k) => k !== 'orchestrator');
  const svgWidth = Math.max(400, childKeys.length * (CARD_W + 20) + 60);
  const svgHeight = 150;
  const positions = useMemo(() => getNodePositions(agentKeys, svgWidth, svgHeight), [agentKeys, svgWidth, svgHeight]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl p-4 h-full"
    >
      <div className="flex items-center justify-between mb-1 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Agent Flow
        </h2>
        {activeAgent && (
          <button
            onClick={() => onAgentClick(null)}
            className="text-xs px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            Clear filter ✕
          </button>
        )}
      </div>
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full mx-auto" style={{ height: 'auto' }}>
        {/* Connection lines */}
        {childKeys.map((key) => (
          <ConnectionPath
            key={`conn-${key}`}
            from={positions.orchestrator}
            to={positions[key]}
            isActive={(statuses[key] || 'idle') === 'working'}
            isDone={(statuses[key] || 'idle') === 'done'}
            color={AGENT_COLORS_HEX[key] || '#818CF8'}
          />
        ))}

        {/* Agent cards */}
        {agentKeys.map((key) => (
          <AgentCard
            key={key}
            agentKey={key}
            agentData={agentMap[key]}
            pos={positions[key]}
            status={statuses[key] || 'idle'}
            isActive={activeAgent === key}
            onClick={onAgentClick}
          />
        ))}
      </svg>
    </motion.div>
  );
}
