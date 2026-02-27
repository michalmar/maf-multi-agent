// Agent color/icon mappings used across all components
export const AGENT_CONFIG = {
  orchestrator: {
    name: 'Orchestrator',
    icon: '🤖',
    role: 'Coordinator',
    color: 'var(--agent-orchestrator)',
    tailwind: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-400', ring: 'ring-indigo-500/40', glow: 'glow-indigo' },
  },
  flights_tool: {
    name: 'Flights Agent',
    icon: '✈️',
    role: 'Flight Specialist',
    color: 'var(--agent-flights)',
    tailwind: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', ring: 'ring-amber-500/40', glow: 'glow-amber' },
  },
  hotels_tool: {
    name: 'Hotels Agent',
    icon: '🏨',
    role: 'Accommodation',
    color: 'var(--agent-hotels)',
    tailwind: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400', ring: 'ring-rose-500/40', glow: 'glow-rose' },
  },
  websearch_tool: {
    name: 'WebSearch',
    icon: '🔍',
    role: 'Research',
    color: 'var(--agent-websearch)',
    tailwind: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400', ring: 'ring-cyan-500/40', glow: 'glow-cyan' },
  },
};

export function getAgentConfig(source) {
  return AGENT_CONFIG[source] || AGENT_CONFIG.orchestrator;
}

// Raw hex values for SVG use
export const AGENT_COLORS_HEX = {
  orchestrator: '#818CF8',
  flights_tool: '#FBBF24',
  hotels_tool: '#FB7185',
  websearch_tool: '#22D3EE',
};
