export type ThemeMode = "night" | "daybreak";
export type RunStatus = "idle" | "running" | "done" | "error";
export type WorkspaceTab = "activity" | "document" | "result" | "tasks";
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
  | "workflow_completed";

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "workflow_started", "reasoning", "tool_decision", "tasks_created",
  "task_completed", "document_updated", "agent_started", "agent_streaming",
  "agent_completed", "agent_error", "output", "workflow_completed",
]);

export function isKnownEventType(type: string): type is EventType {
  return KNOWN_EVENT_TYPES.has(type);
}

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
  cached_tokens?: number;
  reasoning_tokens?: number;
}

export interface SourceTokenUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  by_source: Record<string, SourceTokenUsage>;
}

export type PostRunActionType =
  | "send_email"
  | "create_support_ticket"
  | "schedule_maintenance";

export type PostRunActionPriority = "normal" | "high" | "urgent";

export interface PostRunActionSubmission {
  submission_id: string;
  action_type: PostRunActionType;
  reference_id: string;
  status: "success";
  message: string;
  submitted_at: string;
  payload?: Record<string, unknown>;
  submitted_by?: string | null;
}

export interface PostRunAction {
  type: PostRunActionType;
  label: string;
  description: string;
  priority: PostRunActionPriority;
  enabled: boolean;
  draft: Record<string, unknown>;
  latest_submission?: PostRunActionSubmission | null;
}

export interface PostRunActionsResponse {
  run_id: string;
  status: "ready";
  result_title: string;
  actions: PostRunAction[];
}

export interface ExecutePostRunActionResponse {
  success: boolean;
  run_id: string;
  action_type: PostRunActionType;
  submission_id: string;
  reference_id: string;
  message: string;
  submitted_at: string;
}

export interface EventData {
  // workflow_started
  query?: string;

  // reasoning / agent_streaming / output
  text?: string;

  // tool_decision
  tool?: string;
  arguments?: unknown;

  // tasks_created
  tasks?: TaskItem[];

  // task_completed / agent_started
  task_id?: number;

  // document_updated
  version?: number;
  content?: string;
  history?: { action?: string; [key: string]: unknown };

  // agent_started / agent_streaming / agent_completed / agent_error
  agent_name?: string;

  // agent_completed / output
  result?: string;
  document?: string;

  // agent_error
  error?: string;

  // agent_completed / workflow_completed
  elapsed?: number;
  usage?: EventUsage;

  // misc
  length?: number;

  // forward-compat fallback
  [key: string]: unknown;
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
   updated_at?: string;
  status: RunStatus | (string & {});
  event_count: number;
  has_result: boolean;
  user_email?: string;  // present when super-user views cross-user history
  token_usage?: TokenUsage;  // present when token tracking is enabled
}

export interface SessionSnapshot {
  run_id: string;
  query: string;
  timestamp: string;
   updated_at?: string;
  status: RunStatus | (string & {});
  agents: AgentDefinition[];
  events: AgentEvent[];
  tasks: TaskItem[];
  documents: DocumentVersion[];
  result: string;
  stream_label: string;
  token_usage?: TokenUsage;
  post_run_actions?: {
    submissions?: PostRunActionSubmission[];
  };
}
