export type ThemeMode = "night" | "daybreak";
export type RunStatus = "idle" | "running" | "done" | "error";
export type WorkspaceTab = "activity" | "document" | "result";
export type AgentStatus = "idle" | "working" | "done" | "error";
export type RunSource = "live" | "mock" | "replay";

export type EventType =
  | "workflow_started"
  | "reasoning"
  | "tool_decision"
  | "tasks_created"
  | "task_completed"
  | "document_updated"
  | "agent_started"
  | "agent_streaming"
  | "agent_completed"
  | "agent_error"
  | "output"
  | "workflow_completed"
  | "done";

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
  event_type: EventType | (string & {});
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

export interface HistoryItem {
  run_id: string;
  query: string;
  timestamp: string;
  status: RunStatus | (string & {});
  event_count: number;
  has_result: boolean;
  user_email?: string;  // present when super-user views cross-user history
}

export interface SessionSnapshot {
  run_id: string;
  query: string;
  timestamp: string;
  status: RunStatus | (string & {});
  agents: AgentDefinition[];
  events: AgentEvent[];
  tasks: TaskItem[];
  documents: DocumentVersion[];
  result: string;
  stream_label: string;
}
