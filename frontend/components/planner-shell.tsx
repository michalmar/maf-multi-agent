"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, History, Home, LogIn, LogOut, MoonStar, SunMedium } from "lucide-react";
import Image from "next/image";
import { AgentRoster } from "@/components/agent-roster";
import { AgentRosterGraph } from "@/components/agent-roster-graph";
import { HistoryPanel } from "@/components/history-panel";
import { QueryComposer, ReasoningEffort } from "@/components/query-composer";
import { TaskBoard } from "@/components/task-board";
import { WorkspacePanels } from "@/components/workspace-panels";
import { ToastContainer, useToast } from "@/components/toast";
import { getAgentIdentity } from "@/lib/agent-metadata";
import { STARTER_PROMPTS } from "@/lib/starter-prompts";
import {
  AgentDefinition,
  AgentEvent,
  AgentStatus,
  DocumentVersion,
  FabricStatus,
  HistoryItem,
  RunSource,
  RunStatus,
  SessionSnapshot,
  TaskItem,
  WorkspaceTab,
} from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";
import { usePinnedHeader } from "@/hooks/use-pinned-header";
import { useFabricToken } from "@/hooks/use-fabric-token";

const STATUS_COPY: Record<RunStatus, { label: string; description: string }> = {
  idle: {
    label: "Ready",
    description: "Standing by for a new mission brief.",
  },
  running: {
    label: "Streaming",
    description: "Receiving live orchestration events from the backend.",
  },
  done: {
    label: "Settled",
    description: "The current run has completed successfully.",
  },
  error: {
    label: "Attention",
    description: "The run encountered an issue that needs review.",
  },
};

const RUN_SOURCE_COPY: Record<RunSource, { label: string; description: string }> = {
  live: {
    label: "Live API",
    description: "Connected to the backend workflow and SSE stream.",
  },
  mock: {
    label: "Mock replay",
    description: "Local fixture inspired by a completed maintenance run.",
  },
  replay: {
    label: "Session replay",
    description: "Viewing a saved session from run history.",
  },
};

const MISSION_MENU_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "history", label: "History", icon: History },
] as const;

function ensureOrchestratorFirst(agents: AgentDefinition[]) {
  const known = new Map(agents.map((agent) => [agent.name, agent]));
  const orchestrator = known.get("orchestrator") ?? {
    name: "orchestrator",
    display_name: "Orchestrator",
    avatar: "✦",
    role: "Facilitator & coordinator",
    model: "gpt-5.1",
    description: "Coordinates specialist work and synthesizes the final response.",
  };

  const remaining = agents.filter((agent) => agent.name !== "orchestrator");
  return [orchestrator, ...remaining];
}

function normalizeTasks(candidate: unknown): TaskItem[] | null {
  if (!Array.isArray(candidate)) {
    return null;
  }

  return candidate
    .filter((item): item is TaskItem => {
      return (
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "number" &&
        typeof item.text === "string" &&
        typeof item.assigned_to === "string" &&
        typeof item.finished === "boolean"
      );
    })
    .map((item) => ({ ...item }));
}

function appendDocument(previous: DocumentVersion[], document: DocumentVersion) {
  const exists = previous.some(
    (entry) => entry.version === document.version && entry.content === document.content && entry.action === document.action,
  );
  return exists ? previous : [...previous, document];
}

function deriveAgentStatuses(
  agents: AgentDefinition[],
  events: AgentEvent[],
  runStatus: RunStatus,
): Record<string, AgentStatus> {
  const statuses: Record<string, AgentStatus> = Object.fromEntries(agents.map((agent) => [agent.name, "idle" as AgentStatus]));

  if (runStatus === "running") {
    statuses.orchestrator = "working";
  }
  if (runStatus === "done") {
    statuses.orchestrator = "done";
  }
  if (runStatus === "error") {
    statuses.orchestrator = "error";
  }

  for (const event of events) {
    if (event.event_type === "agent_started") {
      statuses[event.source] = "working";
    }
    if (event.event_type === "agent_completed") {
      statuses[event.source] = "done";
    }
    if (event.event_type === "agent_error") {
      statuses[event.source] = "error";
    }
  }

  return statuses;
}

function formatElapsed(events: AgentEvent[]) {
  const workflowCompleted = [...events].reverse().find((event) => event.event_type === "workflow_completed");
  if (workflowCompleted && typeof workflowCompleted.data.elapsed === "number") {
    return `${workflowCompleted.data.elapsed.toFixed(1)}s`;
  }
  return "--";
}

function isDoneSignal(payload: AgentEvent | { event_type: "done" }): payload is { event_type: "done" } {
  return payload.event_type === "done";
}

export function PlannerShell() {
  const { theme, toggleTheme } = useTheme();
  const [runSource, setRunSource] = useState<RunSource>("live");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [documents, setDocuments] = useState<DocumentVersion[]>([]);
  const [result, setResult] = useState("");
  const [draftQuery, setDraftQuery] = useState(STARTER_PROMPTS[0]?.query ?? "");
  const [error, setError] = useState("");
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [highlightedTask, setHighlightedTask] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("activity");
  const [runId, setRunId] = useState<string | null>(null);
  const [streamLabel, setStreamLabel] = useState("Proxy ready. Submit a brief to begin streaming.");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [enabledAgents, setEnabledAgents] = useState<Set<string>>(new Set());
  const [fabricStatus, setFabricStatus] = useState<FabricStatus | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("low");
  const [versionInfo, setVersionInfo] = useState<{ version: string; git_sha: string; build_date: string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);
  const fabricResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toast notifications (#13)
  const { toasts, addToast, dismiss: dismissToast } = useToast();

  // MSAL — acquire Fabric user token for Data Agent
  const { acquireToken, login, logout, isAuthenticated, accountName } = useFabricToken();

  // Pinned header tracking
  const {
    containerRef: missionHeaderContainerRef,
    headerRef: missionHeaderRef,
    height: missionHeaderHeight,
    isPinned: isMissionHeaderPinned,
  } = usePinnedHeader([theme, runId, status, runSource]);

  // History / replay state
  const [sidebarView, setSidebarView] = useState<"agents" | "history">("agents");
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const closeStream = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadAgents() {
      try {
        const response = await fetch("/api/agents", {
          signal: abortController.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load agents (${response.status})`);
        }

        const payload = (await response.json()) as AgentDefinition[];
        if (runSource === "live") {
          const ordered = ensureOrchestratorFirst(payload);
          setAgents(ordered);
          setEnabledAgents(new Set(ordered.map((a) => a.name)));
          setStreamLabel("Backend proxy connected. Agent manifest loaded successfully.");
        }
      } catch (fetchError) {
        if (!abortController.signal.aborted && runSource === "live") {
          setAgents(ensureOrchestratorFirst([]));
          setStreamLabel("Backend proxy unavailable. You can still review the UI shell, but live data is offline.");
        }
      }
    }

    void loadAgents();

    return () => abortController.abort();
  }, [runSource]);

  // Fetch Fabric capacity status on page load
  useEffect(() => {
    const abortController = new AbortController();

    async function loadFabricStatus() {
      try {
        const resp = await fetch("/api/fabric/status", {
          signal: abortController.signal,
          cache: "no-store",
        });
        if (resp.ok) {
          const data = (await resp.json()) as FabricStatus;
          setFabricStatus(data);
        }
      } catch {
        // Fabric status is optional — silently ignore
      }
    }

    void loadFabricStatus();
    return () => abortController.abort();
  }, []);

  // Fetch version info on page load
  useEffect(() => {
    fetch("/api/version", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setVersionInfo(data); })
      .catch(() => {});
  }, []);

  const handleResumeFabric = useCallback(async () => {
    try {
      const resp = await fetch("/api/fabric/resume", { method: "POST" });
      if (resp.ok) {
        setFabricStatus((prev) => prev ? { ...prev, state: "Resuming" } : prev);
        addToast("Fabric resume requested. Checking status in 15 seconds…", "info");
        // Re-check status after a delay (tracked for cleanup)
        fabricResumeTimerRef.current = setTimeout(async () => {
          fabricResumeTimerRef.current = null;
          try {
            const check = await fetch("/api/fabric/status", { cache: "no-store" });
            if (check.ok) {
              const data = await check.json();
              setFabricStatus(data);
              addToast("Fabric capacity status updated.", "success");
            }
          } catch { /* ignore */ }
        }, 15000);
      } else {
        addToast("Failed to resume Fabric capacity.", "error");
      }
    } catch {
      addToast("Could not reach the backend to resume Fabric.", "error");
    }
  }, [addToast]);

  useEffect(() => {
    return () => {
      closeStream();
      if (fabricResumeTimerRef.current) {
        clearTimeout(fabricResumeTimerRef.current);
        fabricResumeTimerRef.current = null;
      }
    };
  }, [closeStream]);

  const handleToggleAgent = useCallback((agentName: string) => {
    if (agentName === "orchestrator") return;
    setEnabledAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentName)) {
        next.delete(agentName);
      } else {
        next.add(agentName);
      }
      return next;
    });
  }, []);

  const handleIncomingEvent = useCallback((event: AgentEvent) => {
    setEvents((previous) => [...previous, event]);

    if (event.event_type === "tasks_created" || event.event_type === "task_completed") {
      const nextTasks = normalizeTasks(event.data.tasks);
      if (nextTasks) {
        setTasks(nextTasks);
      }
    }

    if (event.event_type === "document_updated" && typeof event.data.content === "string" && typeof event.data.version === "number") {
      const version = event.data.version;
      const content = event.data.content;
      const action = typeof event.data.history?.action === "string" ? event.data.history.action : "update";

      setDocuments((previous) =>
        appendDocument(previous, {
          version,
          content,
          action,
        }),
      );
    }

    if (event.event_type === "output" && event.source === "orchestrator") {
      const nextText = typeof event.data.text === "string" ? event.data.text : "";
      const nextDocument = typeof event.data.document === "string" ? event.data.document : "";

      setResult(nextText);
      if (nextDocument) {
        setDocuments((previous) => appendDocument(previous, { version: "final", content: nextDocument, action: "final" }));
      }
      setActiveTab("result");
    }

    if (event.event_type === "workflow_completed") {
      setStatus((previous) => (previous === "error" ? previous : "done"));
      setStreamLabel("Run complete. Review the final result or inspect the timeline.");
    }

    if (event.event_type === "agent_error" && typeof event.data.error === "string") {
      setError(event.data.error);
      if (event.source === "orchestrator") {
        setStatus("error");
      }
    }
  }, []);

  const connectSSE = useCallback(
    (runIdValue: string) => {
      const sseBase = process.env.NEXT_PUBLIC_BACKEND_API_URL || "";
      const eventSource = new EventSource(`${sseBase}/api/stream/${runIdValue}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        reconnectAttemptRef.current = 0;
        setStreamLabel("Live stream connected. Events will appear in the activity workspace.");
        setError("");
      };

      eventSource.onmessage = (message) => {
        try {
          const parsed = JSON.parse(message.data) as AgentEvent | { event_type: "done" };
          if (isDoneSignal(parsed)) {
            completedRef.current = true;
            closeStream();
            setStatus((previous) => (previous === "error" ? previous : "done"));
            setStreamLabel("Run closed cleanly. You can launch another mission at any time.");
            return;
          }
          handleIncomingEvent(parsed);
        } catch {
          // Ignore unparseable SSE messages
        }
      };

      eventSource.onerror = () => {
        // Close this failed connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        // Don't reconnect if the run already completed or was intentionally closed
        if (completedRef.current) return;

        const MAX_RETRIES = 5;
        const attempt = reconnectAttemptRef.current;

        if (attempt < MAX_RETRIES) {
          reconnectAttemptRef.current = attempt + 1;
          const delay = Math.min(1000 * 2 ** attempt, 16_000);
          setStreamLabel(`Connection lost. Reconnecting (${attempt + 1}/${MAX_RETRIES})...`);

          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connectSSE(runIdValue);
          }, delay);
        } else {
          // Exhausted retries
          setError("The event stream disconnected and could not reconnect after multiple attempts.");
          setStatus((previous) => (previous === "done" ? previous : "error"));
          setStreamLabel("Connection lost. Review the captured events or retry the mission.");
        }
      };
    },
    [closeStream, handleIncomingEvent],
  );

  const handleRun = useCallback(
    async (query: string) => {
      closeStream();
      completedRef.current = false;
      reconnectAttemptRef.current = 0;
      setRunSource("live");
      setStatus("running");
      setEvents([]);
      setTasks([]);
      setDocuments([]);
      setResult("");
      setError("");
      setRunId(null);
      setActiveAgent(null);
      setHighlightedTask(null);
      setActiveTab("activity");
      setDraftQuery(query);
      setStreamLabel("Mission submitted. Waiting for the SSE stream to attach.");

      try {
        // Acquire Fabric user token (silent or popup) — null if MSAL not ready
        const userToken = await acquireToken();

        const response = await fetch("/api/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            selected_agents: Array.from(enabledAgents).filter((name) => name !== "orchestrator"),
            reasoning_effort: reasoningEffort,
            ...(userToken ? { user_token: userToken } : {}),
          }),
        });

        if (!response.ok) {
          throw new Error(`Run request failed with HTTP ${response.status}`);
        }

        const payload = (await response.json()) as { run_id: string };
        setRunId(payload.run_id);

        connectSSE(payload.run_id);
      } catch (runError) {
        closeStream();
        setStatus("error");
        setError(runError instanceof Error ? runError.message : "Unknown run error");
        setStreamLabel("The run could not be started. Verify the backend and try again.");
      }
    },
    [closeStream, connectSSE, enabledAgents, reasoningEffort, acquireToken],
  );

  const handleLoadMock = useCallback(async () => {
    closeStream();
    // Lazy-load the large mock fixture to reduce initial bundle size
    const { getMaintenanceMockScenario } = await import("@/lib/mock-scenarios");
    const scenario = getMaintenanceMockScenario();

    setRunSource("mock");
    setStatus("done");
    setEvents(scenario.events);
    setTasks(scenario.tasks);
    setDocuments(scenario.documents);
    setResult(scenario.result);
    setDraftQuery(scenario.query);
    setError("");
    setAgents(ensureOrchestratorFirst(scenario.agents));
    setEnabledAgents(new Set(ensureOrchestratorFirst(scenario.agents).map((a) => a.name)));
    setActiveAgent(null);
    setHighlightedTask(null);
    setActiveTab("activity");
    setRunId(scenario.runId);
    setStreamLabel(scenario.streamLabel);
  }, [closeStream]);

  // ── History / Replay ─────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/history");
      if (res.ok) {
        const data = (await res.json()) as HistoryItem[];
        setHistoryItems(data);
      }
    } catch {
      // silent — history is non-critical
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load history when switching to history tab
  useEffect(() => {
    if (sidebarView === "history") {
      fetchHistory();
    }
  }, [sidebarView, fetchHistory]);

  // Refresh history after a run completes
  useEffect(() => {
    if (status === "done" && runSource === "live") {
      fetchHistory();
    }
  }, [status, runSource, fetchHistory]);

  const handleLoadReplay = useCallback(
    async (replayRunId: string) => {
      closeStream();
      try {
        const res = await fetch(`/api/history/${replayRunId}`);
        if (!res.ok) throw new Error("Failed to load session");
        const snap = (await res.json()) as SessionSnapshot;

        setRunSource("replay");
        setStatus("done");
        setEvents(snap.events);
        setTasks(snap.tasks);
        setDocuments(snap.documents);
        setResult(snap.result);
        setDraftQuery(snap.query);
        setError("");
        setAgents(ensureOrchestratorFirst(snap.agents));
        setEnabledAgents(new Set(ensureOrchestratorFirst(snap.agents).map((a) => a.name)));
        setActiveAgent(null);
        setHighlightedTask(null);
        setActiveTab("activity");
        setRunId(snap.run_id);
        setStreamLabel(snap.stream_label || `Replay of run ${snap.run_id}`);
        setSidebarView("agents");
        addToast("Session replay loaded.", "success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load replay";
        setError(msg);
        addToast(msg, "error");
      }
    },
    [closeStream, addToast],
  );

  const handleDeleteHistory = useCallback(
    async (deleteRunId: string) => {
      try {
        const res = await fetch(`/api/history/${deleteRunId}`, { method: "DELETE" });
        if (res.ok) {
          setHistoryItems((prev) => prev.filter((item) => item.run_id !== deleteRunId));
          addToast("Session deleted.", "success");
          if (runId === deleteRunId) {
            setRunSource("live");
            setStatus("idle");
            setEvents([]);
            setTasks([]);
            setDocuments([]);
            setResult("");
            setRunId(null);
          }
        } else {
          addToast("Failed to delete session.", "error");
        }
      } catch {
        addToast("Could not reach backend to delete session.", "error");
      }
    },
    [runId, addToast],
  );

  const rosterAgents = useMemo(() => ensureOrchestratorFirst(agents), [agents]);

  const agentEventCounts = useMemo(() => {
    return events.reduce<Record<string, number>>((counts, event) => {
      counts[event.source] = (counts[event.source] ?? 0) + 1;
      return counts;
    }, {});
  }, [events]);

  const agentStatuses = useMemo(
    () => deriveAgentStatuses(rosterAgents, events, status),
    [events, rosterAgents, status],
  );

  const statusCopy = STATUS_COPY[status];
  const sourceCopy = RUN_SOURCE_COPY[runSource];
  const selectedAgent = useMemo(
    () => (activeAgent ? getAgentIdentity(rosterAgents.find((agent) => agent.name === activeAgent) ?? activeAgent) : null),
    [activeAgent, rosterAgents],
  );

  const completedTasks = useMemo(() => tasks.filter((task) => task.finished).length, [tasks]);
  const liveMetrics = useMemo(
    () => [
      { label: "Events", value: String(events.filter((event) => event.event_type !== "agent_streaming").length).padStart(2, "0") },
      { label: "Tasks", value: `${completedTasks}/${tasks.length || 0}` },
      { label: "Drafts", value: String(documents.length).padStart(2, "0") },
      { label: "Elapsed", value: formatElapsed(events) },
    ],
    [events, completedTasks, tasks.length, documents.length],
  );

  const selectedAgentSummary = useMemo(() => selectedAgent
    ? {
        title: selectedAgent.displayName,
        subtitle: selectedAgent.role,
        body: selectedAgent.description || "Agent focus is applied to the activity timeline for quicker analysis.",
      }
    : highlightedTask !== null
      ? {
          title: `Task #${highlightedTask}`,
          subtitle: "Highlighted across the board",
          body: "Use the graph and activity timeline together to trace which agent touched this task and how the work progressed.",
        }
      : runSource === "mock" || runSource === "replay"
        ? {
            title: runSource === "replay" ? "Session replay active" : "Mock replay active",
            subtitle: "Offline viewing mode",
            body: runSource === "replay"
              ? "You are viewing a saved session replay. Browse the activity feed, documents, and final result from this past run."
              : "You are viewing a local maintenance replay fixture. Use it to refine spacing, graph density, and workspace behavior without waiting on the backend orchestration loop.",
          }
        : {
            title: "No active focus",
            subtitle: "Selection inspector",
            body: "Select an agent or task to narrow the activity feed and keep context in view while you inspect the run.",
          },
  [selectedAgent, highlightedTask, runSource]);

  const sourceChipStyle = useMemo(() =>
    runSource === "mock" || runSource === "replay"
      ? {
          borderColor: "rgba(0, 184, 217, 0.18)",
          background: "rgba(0, 184, 217, 0.08)",
          color: "var(--accent-alt)",
        }
      : {
          borderColor: "rgba(99, 91, 255, 0.16)",
          background: "rgba(99, 91, 255, 0.08)",
          color: "var(--accent)",
        },
  [runSource]);

  const missionBriefCollapseMode: "idle" | "running" | "settled" | "mock" =
    runSource === "mock" || runSource === "replay" ? "mock" : status === "running" ? "running" : status === "done" ? "settled" : "idle";

  const missionBriefCondensedLabel =
    missionBriefCollapseMode === "mock"
      ? runSource === "replay" ? "Replay" : "Mock replay"
      : missionBriefCollapseMode === "running"
        ? "Streaming"
        : missionBriefCollapseMode === "settled"
          ? "Settled"
          : "Ready";

  const missionHeaderPanel = (
    <header
      ref={missionHeaderRef}
      className={`panel-shell w-full overflow-hidden transition-[padding,box-shadow,border-radius] duration-200 ${
        isMissionHeaderPinned ? "px-3 py-2 sm:px-4 sm:py-2.5" : "px-4 py-4 sm:px-5 sm:py-5"
      }`}
    >
      {isMissionHeaderPinned ? (
        /* ── Compact pinned layout: single row, badges + menu + run ID + theme ── */
        <div className="flex items-center gap-3">
          <Image src="/logo.svg" alt="Wired Orchestra" width={24} height={24} className="shrink-0" />
          <div className="flex items-center gap-2">
            <span className="status-chip">{statusCopy.label}</span>
            <span className="source-chip" style={sourceChipStyle}>
              {sourceCopy.label}
            </span>
          </div>

          <nav className="mission-menu mission-menu-compact" aria-label="Mission control">
            {MISSION_MENU_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === "home" ? true : item.id === "history" && sidebarView === "history";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.id === "history" ? () => {
                    setSidebarView((v) => v === "history" ? "agents" : "history");
                    if (sidebarCollapsed) setSidebarCollapsed(false);
                  } : undefined}
                  className={`mission-menu-button mission-menu-button-compact ${isActive ? "mission-menu-button-active" : ""}`}
                  aria-current={item.id === "home" ? "page" : undefined}
                  aria-pressed={item.id === "history" ? sidebarView === "history" : undefined}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {runId ? (
              <span className="font-mono text-xs text-[var(--text-muted)]" title={runId}>{runId.slice(0, 3)}</span>
            ) : null}

            <button
              type="button"
              onClick={toggleTheme}
              className="secondary-button secondary-button-compact"
              aria-label={theme === "night" ? "Switch to day mode" : "Switch to night mode"}
            >
              {theme === "night" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : (
        /* ── Full expanded layout ── */
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <Image src="/logo.svg" alt="Wired Orchestra" width={40} height={40} className="shrink-0" />
              <span className="eyebrow">Mission Control</span>
              <span className="status-chip">{statusCopy.label}</span>
              <span className="source-chip" style={sourceChipStyle}>
                {sourceCopy.label}
              </span>
            </div>

            
          </div>

          <div className="flex w-full max-w-[36rem] flex-col gap-3 xl:items-end">
            <nav className="mission-menu" aria-label="Mission control">
              {MISSION_MENU_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === "home" ? true : item.id === "history" && sidebarView === "history";
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={item.id === "history" ? () => {
                      setSidebarView((v) => v === "history" ? "agents" : "history");
                      if (sidebarCollapsed) setSidebarCollapsed(false);
                    } : undefined}
                    className={`mission-menu-button ${isActive ? "mission-menu-button-active" : ""}`}
                    aria-current={item.id === "home" ? "page" : undefined}
                    aria-pressed={item.id === "history" ? sidebarView === "history" : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                );
              })}
              <button
              type="button"
              onClick={toggleTheme}
              className="secondary-button secondary-button-compact"
              aria-label={theme === "night" ? "Switch to day mode" : "Switch to night mode"}
            >
              {theme === "night" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
            </button>
            </nav>

            
          </div>
        </div>
      )}
    </header>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={`sidebar-rail ${sidebarCollapsed ? "sidebar-rail-collapsed" : ""}`}>
        <div className="sidebar-content">
        {!sidebarCollapsed ? (
          <div className="sidebar-view-tabs" role="tablist" aria-label="Sidebar view">
            <button
              type="button"
              role="tab"
              aria-selected={sidebarView === "agents"}
              className={`sidebar-view-tab ${sidebarView === "agents" ? "sidebar-view-tab-active" : ""}`}
              onClick={() => setSidebarView("agents")}
            >
              Agents
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarView === "history"}
              className={`sidebar-view-tab ${sidebarView === "history" ? "sidebar-view-tab-active" : ""}`}
              onClick={() => setSidebarView("history")}
            >
              <History className="h-3.5 w-3.5" />
              History
            </button>
          </div>
        ) : null}

        {sidebarView === "agents" || sidebarCollapsed ? (
          <AgentRoster
            activeAgent={activeAgent}
            agents={rosterAgents}
            collapsed={sidebarCollapsed}
            enabledAgents={enabledAgents}
            eventCounts={agentEventCounts}
            fabricStatus={fabricStatus}
            highlightedTask={highlightedTask}
            liveMetrics={liveMetrics}
            onSelectAgent={setActiveAgent}
            onResumeFabric={handleResumeFabric}
            onToggle={() => setSidebarCollapsed((c) => !c)}
            onToggleAgent={handleToggleAgent}
            running={status === "running"}
            runSource={runSource}
            selectedAgentSummary={selectedAgentSummary}
            statusByAgent={agentStatuses}
          />
        ) : (
          <HistoryPanel
            collapsed={sidebarCollapsed}
            items={historyItems}
            activeRunId={runId}
            onLoad={handleLoadReplay}
            onDelete={handleDeleteHistory}
            loading={historyLoading}
          />
        )}
        </div>

        {/* User profile indicator — pinned to sidebar bottom */}
        <div className={`sidebar-user-profile ${sidebarCollapsed ? "sidebar-user-profile-collapsed" : ""}`}>
          {isAuthenticated ? (
            <button type="button" onClick={logout} className="sidebar-user-btn" title={`Sign out ${accountName}`}>
              <span className="sidebar-user-avatar">
                {accountName ? accountName.charAt(0).toUpperCase() : "U"}
              </span>
              {!sidebarCollapsed && (
                <span className="sidebar-user-info">
                  <span className="sidebar-user-name">{accountName ?? "User"}</span>
                  <span className="sidebar-user-status">Signed in · Fabric</span>
                </span>
              )}
            </button>
          ) : (
            <button type="button" onClick={login} className="sidebar-user-btn" title="Sign in for Fabric Data Agent">
              <span className="sidebar-user-avatar sidebar-user-avatar-anon">
                <LogIn className="h-3.5 w-3.5" />
              </span>
              {!sidebarCollapsed && (
                <span className="sidebar-user-info">
                  <span className="sidebar-user-name">Sign in</span>
                  <span className="sidebar-user-status">Required for Data Agent</span>
                </span>
              )}
            </button>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5 lg:px-6">
        <div
          ref={missionHeaderContainerRef}
          className="w-full"
          style={isMissionHeaderPinned && missionHeaderHeight ? { height: `${missionHeaderHeight}px` } : undefined}
        >
          {isMissionHeaderPinned ? (
            <div
              className="pointer-events-none fixed top-0 right-0 z-40 px-4 pt-2 sm:px-5 sm:pt-3 lg:px-6"
              style={{ left: "var(--sidebar-width)" }}
            >
              <div className="pointer-events-auto mx-auto w-full max-w-[1600px]">{missionHeaderPanel}</div>
            </div>
          ) : (
            missionHeaderPanel
          )}
        </div>

        {error ? (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel-shell panel-shell-danger px-5 py-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--danger)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Backend or streaming issue</p>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{error}</p>
              </div>
            </div>
          </motion.div>
        ) : null}

        <QueryComposer
          collapseMode={missionBriefCollapseMode}
          condensedStateLabel={missionBriefCondensedLabel}
          disabled={status === "running"}
          isMockActive={runSource === "mock" || runSource === "replay"}
          onLoadMock={handleLoadMock}
          onQueryChange={setDraftQuery}
          onRun={handleRun}
          query={draftQuery}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
        />

        <AgentRosterGraph
          agents={rosterAgents}
          activeAgent={activeAgent}
          enabledAgents={enabledAgents}
          eventCounts={agentEventCounts}
          statusByAgent={agentStatuses}
          onSelectAgent={setActiveAgent}
        />

        <TaskBoard
          highlightedTask={highlightedTask}
          onSelectTask={setHighlightedTask}
          running={status === "running"}
          tasks={tasks}
        />

        <WorkspacePanels
          activeAgent={activeAgent}
          activeTab={activeTab}
          documents={documents}
          events={events}
          highlightedTask={highlightedTask}
          onTabChange={setActiveTab}
          result={result}
          running={status === "running"}
          status={status}
        />

        <p className="sr-only" aria-live="polite">
          {streamLabel}
        </p>

        {versionInfo ? (
          <footer className="version-footer">
            v{versionInfo.version}
            {versionInfo.git_sha !== "unknown" ? ` (${versionInfo.git_sha})` : ""}
            {versionInfo.build_date !== "unknown" ? ` · ${versionInfo.build_date.split("T")[0]}` : ""}
          </footer>
        ) : null}
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
