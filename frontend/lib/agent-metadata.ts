import { AgentDefinition, AgentStatus } from "@/lib/types";

interface AgentTone {
  label: string;
  icon: string;
  fallbackRole: string;
  accent: string;
  soft: string;
  border: string;
}

const AGENT_TONES: Record<string, AgentTone> = {
  orchestrator: {
    label: "Orchestrator",
    icon: "✦",
    fallbackRole: "Facilitator",
    accent: "#80BFFF",
    soft: "rgba(128, 191, 255, 0.14)",
    border: "rgba(128, 191, 255, 0.34)",
  },
  flights_tool: {
    label: "Flights",
    icon: "✈",
    fallbackRole: "Flight specialist",
    accent: "#F5C06A",
    soft: "rgba(245, 192, 106, 0.16)",
    border: "rgba(245, 192, 106, 0.34)",
  },
  hotels_tool: {
    label: "Hotels",
    icon: "▣",
    fallbackRole: "Accommodation specialist",
    accent: "#F38BA8",
    soft: "rgba(243, 139, 168, 0.16)",
    border: "rgba(243, 139, 168, 0.34)",
  },
  websearch_tool: {
    label: "Web Search",
    icon: "◌",
    fallbackRole: "Research specialist",
    accent: "#70D6E8",
    soft: "rgba(112, 214, 232, 0.16)",
    border: "rgba(112, 214, 232, 0.34)",
  },
  coder_tool: {
    label: "Coder Agent",
    icon: "⌘",
    fallbackRole: "Implementation specialist",
    accent: "#86E0B0",
    soft: "rgba(134, 224, 176, 0.16)",
    border: "rgba(134, 224, 176, 0.34)",
  },
  data_analyst_tool: {
    label: "Data Analyst",
    icon: "◫",
    fallbackRole: "Signal analyst",
    accent: "#C8B4FF",
    soft: "rgba(200, 180, 255, 0.16)",
    border: "rgba(200, 180, 255, 0.34)",
  },
  kb_tool: {
    label: "Knowledge Base",
    icon: "☰",
    fallbackRole: "Documentation specialist",
    accent: "#F8A96E",
    soft: "rgba(248, 169, 110, 0.16)",
    border: "rgba(248, 169, 110, 0.34)",
  },
  taskboard: {
    label: "Task Board",
    icon: "≡",
    fallbackRole: "Planner state",
    accent: "#CBB6FF",
    soft: "rgba(203, 182, 255, 0.16)",
    border: "rgba(203, 182, 255, 0.34)",
  },
};

const FALLBACK_TONE: AgentTone = {
  label: "Specialist",
  icon: "•",
  fallbackRole: "Specialist agent",
  accent: "#A6B2C8",
  soft: "rgba(166, 178, 200, 0.12)",
  border: "rgba(166, 178, 200, 0.28)",
};

const STATUS_TONES: Record<AgentStatus, { label: string; color: string; background: string }> = {
  idle: {
    label: "Idle",
    color: "#A8B4C9",
    background: "rgba(168, 180, 201, 0.12)",
  },
  working: {
    label: "Running",
    color: "#7EC8FF",
    background: "rgba(126, 200, 255, 0.18)",
  },
  done: {
    label: "Settled",
    color: "#85D4AE",
    background: "rgba(133, 212, 174, 0.18)",
  },
  error: {
    label: "Alert",
    color: "#F38B8B",
    background: "rgba(243, 139, 139, 0.18)",
  },
};

export function getAgentTone(name: string): AgentTone {
  return AGENT_TONES[name] ?? {
    ...FALLBACK_TONE,
    label: humanizeAgentName(name),
  };
}

export function getAgentIdentity(agentOrName: AgentDefinition | string | undefined) {
  const name = typeof agentOrName === "string" ? agentOrName : agentOrName?.name ?? "unknown";
  const tone = getAgentTone(name);

  return {
    key: name,
    displayName:
      typeof agentOrName === "string"
        ? tone.label
        : agentOrName?.display_name || tone.label,
    avatar:
      typeof agentOrName === "string"
        ? tone.icon
        : agentOrName?.avatar || tone.icon,
    role:
      typeof agentOrName === "string"
        ? tone.fallbackRole
        : agentOrName?.role || tone.fallbackRole,
    model: typeof agentOrName === "string" ? "" : agentOrName?.model || "",
    description: typeof agentOrName === "string" ? "" : agentOrName?.description || "",
    ...tone,
  };
}

export function getStatusTone(status: AgentStatus) {
  return STATUS_TONES[status];
}

export function humanizeAgentName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
