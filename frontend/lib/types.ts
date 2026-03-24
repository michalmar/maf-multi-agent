export type ThemeMode = "night" | "daybreak";
export type RunStatus = "idle" | "running" | "done" | "error";
export type WorkspaceTab = "activity" | "document" | "result";
export type AgentStatus = "idle" | "working" | "done" | "error";
export type RunSource = "live" | "mock";

export interface AgentDefinition {
  name: string;
  display_name: string;
  avatar?: string;
  role?: string;
  model?: string;
  description?: string;
}

export interface TaskItem {
  id: number;
  text: string;
  assigned_to: string;
  finished: boolean;
}

export interface DocumentVersion {
  version: number | "final";
  content: string;
  action: string;
}

export interface EventUsage {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface EventData {
  [key: string]: unknown;
  tasks?: TaskItem[];
  task_id?: number;
  text?: string;
  query?: string;
  tool?: string;
  arguments?: unknown;
  version?: number;
  content?: string;
  history?: {
    action?: string;
    [key: string]: unknown;
  };
  document?: string;
  error?: string;
  elapsed?: number;
  length?: number;
  usage?: EventUsage;
  agent_name?: string;
  result?: string;
}

export interface AgentEvent {
  event_type: string;
  source: string;
  data: EventData;
  timestamp: number;
  event_summary?: string;
}

export interface FabricStatus {
  enabled: boolean;
  state?: string;
  sku?: string;
  name?: string;
  resource_group?: string;
  error?: string;
}
