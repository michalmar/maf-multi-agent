import React, { useMemo, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { AGENT_COLORS_HEX, getAgentConfig } from '../agentConfig';

const CARD_W = 172;
const CARD_H = 56;
const GRID_SIZE = 20;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const SCALE_STEP = 0.15;

function getNodePositions(agentKeys, width, height) {
  const cx = width / 2;
  const topY = height / 2 - 40;
  const botY = height / 2 + 40;
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
  idle:    { label: 'Idle',    bg: 'var(--bg-surface-hover)', color: 'var(--text-muted)' },
  working: { label: 'Running', bg: 'color-mix(in srgb, #3B82F6 12%, transparent)', color: '#3B82F6' },
  done:    { label: 'Done',    bg: 'color-mix(in srgb, #10B981 12%, transparent)', color: '#10B981' },
  error:   { label: 'Error',   bg: 'color-mix(in srgb, #EF4444 12%, transparent)', color: '#EF4444' },
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
    <g onClick={(e) => { e.stopPropagation(); onClick(agentKey); }} className="cursor-pointer" role="button" tabIndex={0}
       onPointerDown={(e) => e.stopPropagation()}>
      {/* Drop shadow rect */}
      <rect
        x={left + 2}
        y={top + 2}
        width={CARD_W}
        height={CARD_H}
        rx={12}
        fill="rgba(0,0,0,0.15)"
        filter="url(#card-blur)"
      />
      <foreignObject x={left} y={top} width={CARD_W} height={CARD_H}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: CARD_W,
            height: CARD_H,
            background: isActive ? `color-mix(in srgb, ${hex} 6%, var(--bg-surface))` : 'var(--bg-surface)',
            border: `1px solid ${isActive || status !== 'idle' ? `color-mix(in srgb, ${hex} 30%, transparent)` : 'var(--border-subtle)'}`,
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            padding: '0 12px',
            position: 'relative',
            overflow: 'hidden',
            transition: 'border-color 0.2s, background 0.2s',
          }}
        >
          {/* Avatar with spinner ring */}
          <div style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
            {isWorking && (
              <svg
                width={36} height={36}
                style={{
                  position: 'absolute', top: -2, left: -2,
                  animation: 'spin-ring 1.2s linear infinite',
                }}
              >
                <circle cx={18} cy={18} r={16} fill="none" stroke={hex} strokeWidth={2} strokeDasharray="28 72" strokeLinecap="round" opacity={0.7} />
              </svg>
            )}
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15,
              background: `color-mix(in srgb, ${hex} 10%, transparent)`,
              border: `1.5px solid ${status !== 'idle' ? `color-mix(in srgb, ${hex} 40%, transparent)` : 'var(--border-subtle)'}`,
              transition: 'border-color 0.2s',
            }}>
              {cfg.icon}
            </div>
          </div>

          {/* Name + model + badge */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
                lineHeight: 1.2, fontFamily: "'Inter', system-ui, sans-serif",
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {cfg.name}
              </span>
              <span style={{
                fontSize: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                padding: '1px 5px', borderRadius: 4, lineHeight: '14px', flexShrink: 0,
                background: badge.bg,
                color: badge.color,
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                {isWorking && (
                  <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: badge.color, animation: 'pulse-dot 1s ease-in-out infinite' }} />
                )}
                {badge.label}
              </span>
            </div>
            {model && (
              <div style={{
                fontSize: 9, color: 'var(--text-muted)',
                fontFamily: "'Inter', system-ui, sans-serif",
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.3, marginTop: 2,
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

function ElbowPath({ from, to, isActive, isDone, color }) {
  const fromY = from.y + CARD_H / 2;
  const toY = to.y - CARD_H / 2;
  const midY = (fromY + toY) / 2;
  const d = `M ${from.x} ${fromY} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${toY}`;

  return (
    <>
      <path d={d} fill="none" stroke={isDone ? color : 'var(--border-subtle)'} strokeWidth={1.5} opacity={isDone ? 0.3 : 0.25} strokeLinejoin="round" />
      {isActive && (
        <path d={d} fill="none" stroke={color} strokeWidth={2} className="path-flow" opacity={0.6} strokeLinejoin="round" />
      )}
      {/* Arrow at the end */}
      <polygon
        points={`${to.x - 4} ${toY - 6}, ${to.x + 4} ${toY - 6}, ${to.x} ${toY}`}
        fill={isActive ? color : isDone ? color : 'var(--border-subtle)'}
        opacity={isActive ? 0.6 : isDone ? 0.3 : 0.25}
      />
    </>
  );
}

function CanvasToolbar({ scale, onZoomIn, onZoomOut, onReset }) {
  const pct = Math.round(scale * 100);
  return (
    <div className="flex items-center gap-0.5 rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <button onClick={onZoomIn} disabled={scale >= MAX_SCALE}
        className="p-1.5 transition-colors disabled:opacity-30"
        style={{ color: 'var(--text-muted)' }}
        title="Zoom in">
        <ZoomIn size={13} />
      </button>
      <span className="text-[10px] font-medium tabular-nums px-1 min-w-[34px] text-center select-none"
        style={{ color: 'var(--text-muted)' }}>
        {pct}%
      </span>
      <button onClick={onZoomOut} disabled={scale <= MIN_SCALE}
        className="p-1.5 transition-colors disabled:opacity-30"
        style={{ color: 'var(--text-muted)' }}
        title="Zoom out">
        <ZoomOut size={13} />
      </button>
      <div className="w-px h-4" style={{ background: 'var(--border-subtle)' }} />
      <button onClick={onReset}
        className="p-1.5 transition-colors"
        style={{ color: 'var(--text-muted)' }}
        title="Fit to view">
        <Maximize2 size={13} />
      </button>
    </div>
  );
}

export default function AgentFlowGraph({ agents, events, workflowStatus, activeAgent, onAgentClick }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef(null);
  const svgRef = useRef(null);

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
  const baseWidth = Math.max(400, childKeys.length * (CARD_W + 20) + 80);
  const baseHeight = 180;
  const positions = useMemo(() => getNodePositions(agentKeys, baseWidth, baseHeight), [agentKeys, baseWidth, baseHeight]);

  const zoomIn = useCallback(() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP)), []);
  const resetView = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

  // Wheel zoom
  const handleWheel = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setScale((s) => {
      const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP;
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta));
    });
  }, []);

  // Pan handlers
  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    panStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    setIsPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [offset]);

  const handlePointerMove = useCallback((e) => {
    if (!isPanning || !panStart.current) return;
    setOffset({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
    });
  }, [isPanning]);

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
    panStart.current = null;
  }, []);

  // Compute viewBox from scale + offset
  const vbW = baseWidth / scale;
  const vbH = baseHeight / scale;
  const vbX = (baseWidth - vbW) / 2 - offset.x / scale;
  const vbY = (baseHeight - vbH) / 2 - offset.y / scale;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel rounded-xl h-full flex flex-col overflow-hidden"
    >
      {/* Header + toolbar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Agent Flow
        </h2>
        <div className="flex items-center gap-2">
          {activeAgent && (
            <button
              onClick={() => onAgentClick(null)}
              className="text-[10px] px-2 py-0.5 rounded-md transition-colors"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface-hover)' }}
            >
              Clear filter ✕
            </button>
          )}
          <CanvasToolbar scale={scale} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetView} />
        </div>
      </div>

      {/* Canvas */}
      <div
        className="flex-1 relative overflow-hidden rounded-b-xl"
        style={{ background: 'var(--bg-base)', cursor: isPanning ? 'grabbing' : 'grab', minHeight: 140 }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <svg
          ref={svgRef}
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
          style={{ color: 'var(--text-primary)' }}
        >
          <defs>
            {/* Grid pattern — uses rgba for cross-browser SVG compat */}
            <pattern id="grid-small" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
              <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.08" />
            </pattern>
            <pattern id="grid-large" width={GRID_SIZE * 5} height={GRID_SIZE * 5} patternUnits="userSpaceOnUse">
              <rect width={GRID_SIZE * 5} height={GRID_SIZE * 5} fill="url(#grid-small)" />
              <path d={`M ${GRID_SIZE * 5} 0 L 0 0 0 ${GRID_SIZE * 5}`} fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.12" />
            </pattern>
            {/* Blur filter for drop shadows */}
            <filter id="card-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
          </defs>

          {/* Grid background */}
          <rect x={vbX - 200} y={vbY - 200} width={vbW + 400} height={vbH + 400} fill="url(#grid-large)" />

          {/* Elbow connection lines */}
          {childKeys.map((key) => (
            <ElbowPath
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
      </div>
    </motion.div>
  );
}
