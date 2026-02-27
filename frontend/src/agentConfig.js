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
  coder_tool: {
    name: 'Coder Agent',
    icon: '💻',
    role: 'Software Engineer',
    color: 'var(--agent-coder)',
    tailwind: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', ring: 'ring-emerald-500/40', glow: 'glow-green' },
  },
  data_analyst_tool: {
    name: 'Data Analyst',
    icon: '📊',
    role: 'Data Analyst',
    color: 'var(--agent-data-analyst)',
    tailwind: { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400', ring: 'ring-violet-500/40', glow: 'glow-indigo' },
  },
  kb_tool: {
    name: 'KB Agent',
    icon: '🧠',
    role: 'Knowledge Base',
    color: 'var(--agent-kb)',
    tailwind: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', ring: 'ring-orange-500/40', glow: 'glow-amber' },
  },
};

const FALLBACK_CONFIG = {
  name: 'Agent',
  icon: '⚙️',
  role: 'Specialist',
  color: 'var(--text-muted)',
  tailwind: { bg: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400', ring: 'ring-gray-500/40', glow: '' },
};

export function getAgentConfig(source) {
  return AGENT_CONFIG[source] || FALLBACK_CONFIG;
}

// Raw hex values for SVG use
export const AGENT_COLORS_HEX = {
  orchestrator: '#818CF8',
  flights_tool: '#FBBF24',
  hotels_tool: '#FB7185',
  websearch_tool: '#22D3EE',
  coder_tool: '#34D399',
  data_analyst_tool: '#A78BFA',
  kb_tool: '#FB923C',
};
