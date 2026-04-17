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
    accent: "#8a91e6",
    soft: "rgba(138, 145, 230, 0.12)",
    border: "rgba(138, 145, 230, 0.28)",
  },
  flights_tool: {
    label: "Flights",
    icon: Plane,
    fallbackRole: "Flight specialist",
    accent: "#f2c94c",
    soft: "rgba(242, 201, 76, 0.12)",
    border: "rgba(242, 201, 76, 0.28)",
  },
  hotels_tool: {
    label: "Hotels",
    icon: Building2,
    fallbackRole: "Accommodation specialist",
    accent: "#f38ba8",
    soft: "rgba(243, 139, 168, 0.12)",
    border: "rgba(243, 139, 168, 0.28)",
  },
  websearch_tool: {
    label: "Web Search",
    icon: Search,
    fallbackRole: "Research specialist",
    accent: "#70d6e8",
    soft: "rgba(112, 214, 232, 0.12)",
    border: "rgba(112, 214, 232, 0.28)",
  },
  coder_tool: {
    label: "Coder",
    icon: Code2,
    fallbackRole: "Implementation specialist",
    accent: "#86e0b0",
    soft: "rgba(134, 224, 176, 0.12)",
    border: "rgba(134, 224, 176, 0.28)",
  },
  coderdata_tool: {
    label: "Coder Data",
    icon: Code2,
    fallbackRole: "Implementation specialist",
    accent: "#86e0b0",
    soft: "rgba(134, 224, 176, 0.12)",
    border: "rgba(134, 224, 176, 0.28)",
  },
  data_analyst_tool: {
    label: "Data Analyst",
    icon: BarChart3,
    fallbackRole: "Signal analyst",
    accent: "#c8b4ff",
    soft: "rgba(200, 180, 255, 0.12)",
    border: "rgba(200, 180, 255, 0.28)",
  },
  kb_tool: {
    label: "Knowledge Base",
    icon: BookOpen,
    fallbackRole: "Documentation specialist",
    accent: "#f8a96e",
    soft: "rgba(248, 169, 110, 0.12)",
    border: "rgba(248, 169, 110, 0.28)",
  },
  taskboard: {
    label: "Task Board",
    icon: ListTodo,
    fallbackRole: "Planner state",
    accent: "#cbb6ff",
    soft: "rgba(203, 182, 255, 0.12)",
    border: "rgba(203, 182, 255, 0.28)",
  },
};

const FALLBACK_TONE: AgentTone = {
  label: "Specialist",
  icon: Wrench,
  fallbackRole: "Specialist agent",
  accent: "#a6b2c8",
  soft: "rgba(166, 178, 200, 0.10)",
  border: "rgba(166, 178, 200, 0.24)",
};

const STATUS_TONES: Record<AgentStatus, { label: string; color: string; background: string }> = {
  idle: {
    label: "Idle",
    color: "#8a8f98",
    background: "rgba(138, 143, 152, 0.10)",
  },
  working: {
    label: "Running",
    color: "#8a91e6",
    background: "rgba(138, 145, 230, 0.14)",
  },
  done: {
    label: "Settled",
    color: "#4cb782",
    background: "rgba(76, 183, 130, 0.14)",
  },
  error: {
    label: "Alert",
    color: "#eb5757",
    background: "rgba(235, 87, 87, 0.14)",
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
