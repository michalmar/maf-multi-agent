import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Building2,
  Code2,
  Database,
  Globe,
  ListTodo,
  Plane,
  Search,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";
import { AgentDefinition, AgentStatus } from "@/lib/types";

interface AgentTone {
  label: string;
  icon: LucideIcon;
  fallbackRole: string;
  accent: string;
  soft: string;
  border: string;
}

const AGENT_TONES: Record<string, AgentTone> = {
  orchestrator: {
    label: "Orchestrator",
    icon: Sparkles,
    fallbackRole: "Facilitator",
    accent: "#2f81f7",
    soft: "rgba(56, 139, 253, 0.14)",
    border: "rgba(56, 139, 253, 0.32)",
  },
  flights_tool: {
    label: "Flights",
    icon: Plane,
    fallbackRole: "Flight specialist",
    accent: "#d29922",
    soft: "rgba(210, 153, 34, 0.14)",
    border: "rgba(210, 153, 34, 0.32)",
  },
  hotels_tool: {
    label: "Hotels",
    icon: Building2,
    fallbackRole: "Accommodation specialist",
    accent: "#f85149",
    soft: "rgba(248, 81, 73, 0.12)",
    border: "rgba(248, 81, 73, 0.30)",
  },
  websearch_tool: {
    label: "Web Search",
    icon: Search,
    fallbackRole: "Research specialist",
    accent: "#2f81f7",
    soft: "rgba(56, 139, 253, 0.14)",
    border: "rgba(56, 139, 253, 0.32)",
  },
  coder_tool: {
    label: "Coder",
    icon: Code2,
    fallbackRole: "Implementation specialist",
    accent: "#3fb950",
    soft: "rgba(63, 185, 80, 0.14)",
    border: "rgba(63, 185, 80, 0.32)",
  },
  coderdata_tool: {
    label: "Coder Data",
    icon: Code2,
    fallbackRole: "Implementation specialist",
    accent: "#3fb950",
    soft: "rgba(63, 185, 80, 0.14)",
    border: "rgba(63, 185, 80, 0.32)",
  },
  data_analyst_tool: {
    label: "Data Analyst",
    icon: BarChart3,
    fallbackRole: "Signal analyst",
    accent: "#a371f7",
    soft: "rgba(163, 113, 247, 0.14)",
    border: "rgba(163, 113, 247, 0.32)",
  },
  kb_tool: {
    label: "Knowledge Base",
    icon: BookOpen,
    fallbackRole: "Documentation specialist",
    accent: "#f78166",
    soft: "rgba(247, 129, 102, 0.14)",
    border: "rgba(247, 129, 102, 0.32)",
  },
  taskboard: {
    label: "Task Board",
    icon: ListTodo,
    fallbackRole: "Planner state",
    accent: "#a371f7",
    soft: "rgba(163, 113, 247, 0.14)",
    border: "rgba(163, 113, 247, 0.32)",
  },
};

const FALLBACK_TONE: AgentTone = {
  label: "Specialist",
  icon: Wrench,
  fallbackRole: "Specialist agent",
  accent: "#8b949e",
  soft: "rgba(139, 148, 158, 0.14)",
  border: "rgba(139, 148, 158, 0.32)",
};

const STATUS_TONES: Record<AgentStatus, { label: string; color: string; background: string }> = {
  idle: {
    label: "Idle",
    color: "#8b949e",
    background: "rgba(139, 148, 158, 0.12)",
  },
  working: {
    label: "Running",
    color: "#2f81f7",
    background: "rgba(56, 139, 253, 0.14)",
  },
  done: {
    label: "Settled",
    color: "#3fb950",
    background: "rgba(63, 185, 80, 0.14)",
  },
  error: {
    label: "Alert",
    color: "#f85149",
    background: "rgba(248, 81, 73, 0.14)",
  },
};

// Heuristic icon picker for unknown agents based on name keywords
function inferIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("search") || n.includes("web")) return Search;
  if (n.includes("flight")) return Plane;
  if (n.includes("hotel") || n.includes("accom")) return Building2;
  if (n.includes("code") || n.includes("dev")) return Code2;
  if (n.includes("data") || n.includes("analy")) return BarChart3;
  if (n.includes("kb") || n.includes("knowledge") || n.includes("doc")) return BookOpen;
  if (n.includes("db") || n.includes("sql") || n.includes("fabric")) return Database;
  if (n.includes("task") || n.includes("plan")) return ListTodo;
  if (n.includes("orchestr") || n.includes("facili")) return Sparkles;
  if (n.includes("user")) return User;
  if (n.includes("globe") || n.includes("world")) return Globe;
  return Wrench;
}

export function getAgentTone(name: string): AgentTone {
  if (AGENT_TONES[name]) return AGENT_TONES[name];
  return {
    ...FALLBACK_TONE,
    label: humanizeAgentName(name),
    icon: inferIcon(name),
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
    role:
      typeof agentOrName === "string"
        ? tone.fallbackRole
        : agentOrName?.role || tone.fallbackRole,
    model: typeof agentOrName === "string" ? "" : agentOrName?.model || "",
    description: typeof agentOrName === "string" ? "" : agentOrName?.description || "",
    label: tone.label,
    icon: tone.icon,
    accent: tone.accent,
    soft: tone.soft,
    border: tone.border,
  };
}

export function getStatusTone(status: AgentStatus) {
  return STATUS_TONES[status];
}

export function humanizeAgentName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s*tool$/i, "")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
