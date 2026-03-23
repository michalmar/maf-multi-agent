"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, HelpCircle, History, Home, MoonStar, Settings2, SunMedium } from "lucide-react";
import Image from "next/image";
import { AgentRoster } from "@/components/agent-roster";
import { AgentRosterGraph } from "@/components/agent-roster-graph";
import { QueryComposer } from "@/components/query-composer";
import { TaskBoard } from "@/components/task-board";
import { WorkspacePanels } from "@/components/workspace-panels";
import { getAgentIdentity } from "@/lib/agent-metadata";
import { getMaintenanceMockScenario } from "@/lib/mock-scenarios";
import { STARTER_PROMPTS } from "@/lib/starter-prompts";
import {
  AgentDefinition,
  AgentEvent,
  AgentStatus,
  DocumentVersion,
  RunSource,
  RunStatus,
  TaskItem,
  ThemeMode,
  WorkspaceTab,
} from "@/lib/types";

const THEME_STORAGE_KEY = "maf-theme";

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
};

const MISSION_MENU_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "help", label: "Help", icon: HelpCircle },
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
  const missionHeaderContainerRef = useRef<HTMLDivElement | null>(null);
  const missionHeaderRef = useRef<HTMLElement | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("daybreak");
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
  const [missionHeaderHeight, setMissionHeaderHeight] = useState(0);
  const [isMissionHeaderPinned, setIsMissionHeaderPinned] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [enabledAgents, setEnabledAgents] = useState<Set<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === "daybreak" || savedTheme === "night") {
        setTheme(savedTheme);
      }
    } catch (storageError) {
      console.warn("Unable to restore theme", storageError);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (storageError) {
      console.warn("Unable to persist theme", storageError);
    }
  }, [theme]);

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

  useEffect(() => {
    return () => closeStream();
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

  const handleRun = useCallback(
    async (query: string) => {
      closeStream();
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
        const response = await fetch("/api/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            selected_agents: Array.from(enabledAgents).filter((name) => name !== "orchestrator"),
          }),
        });

        if (!response.ok) {
          throw new Error(`Run request failed with HTTP ${response.status}`);
        }

        const payload = (await response.json()) as { run_id: string };
        setRunId(payload.run_id);
        setStreamLabel("Live stream connected. Events will appear in the activity workspace.");

        // Connect EventSource directly to the backend to bypass Next.js dev
        // server response buffering that kills SSE real-time delivery.
        const sseBase = process.env.NEXT_PUBLIC_BACKEND_API_URL || "";
        const eventSource = new EventSource(`${sseBase}/api/stream/${payload.run_id}`);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (message) => {
          const parsed = JSON.parse(message.data) as AgentEvent | { event_type: "done" };
          if (isDoneSignal(parsed)) {
            closeStream();
            setStatus((previous) => (previous === "error" ? previous : "done"));
            setStreamLabel("Run closed cleanly. You can launch another mission at any time.");
            return;
          }

          handleIncomingEvent(parsed);
        };

        eventSource.onerror = () => {
          closeStream();
          setError("The event stream disconnected before the backend finished responding.");
          setStatus((previous) => (previous === "done" ? previous : "error"));
          setStreamLabel("Connection lost. Review the captured events or retry the mission.");
        };
      } catch (runError) {
        closeStream();
        setStatus("error");
        setError(runError instanceof Error ? runError.message : "Unknown run error");
        setStreamLabel("The run could not be started. Verify the backend and try again.");
      }
    },
    [closeStream, handleIncomingEvent, enabledAgents],
  );

  const handleLoadMock = useCallback(() => {
    closeStream();
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

  const completedTasks = tasks.filter((task) => task.finished).length;
  const liveMetrics = [
    { label: "Events", value: String(events.filter((event) => event.event_type !== "agent_streaming").length).padStart(2, "0") },
    { label: "Tasks", value: `${completedTasks}/${tasks.length || 0}` },
    { label: "Drafts", value: String(documents.length).padStart(2, "0") },
    { label: "Elapsed", value: formatElapsed(events) },
  ];

  const selectedAgentSummary = selectedAgent
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
      : runSource === "mock"
        ? {
            title: "Mock replay active",
            subtitle: "Offline tuning mode",
            body: "You are viewing a local maintenance replay fixture. Use it to refine spacing, graph density, and workspace behavior without waiting on the backend orchestration loop.",
          }
        : {
            title: "No active focus",
            subtitle: "Selection inspector",
            body: "Select an agent or task to narrow the activity feed and keep context in view while you inspect the run.",
          };

  const toggleTheme = () => {
    setTheme((current) => (current === "night" ? "daybreak" : "night"));
  };

  const sourceChipStyle =
    runSource === "mock"
      ? {
          borderColor: "rgba(0, 184, 217, 0.18)",
          background: "rgba(0, 184, 217, 0.08)",
          color: "var(--accent-alt)",
        }
      : {
          borderColor: "rgba(99, 91, 255, 0.16)",
          background: "rgba(99, 91, 255, 0.08)",
          color: "var(--accent)",
        };

  const missionBriefCollapseMode: "idle" | "running" | "settled" | "mock" =
    runSource === "mock" ? "mock" : status === "running" ? "running" : status === "done" ? "settled" : "idle";

  const missionBriefCondensedLabel =
    missionBriefCollapseMode === "mock"
      ? "Mock replay"
      : missionBriefCollapseMode === "running"
        ? "Streaming"
        : missionBriefCollapseMode === "settled"
          ? "Settled"
          : "Ready";

  useEffect(() => {
    const missionHeader = missionHeaderRef.current;
    if (!missionHeader) {
      return;
    }

    const updateMissionHeaderHeight = () => {
      setMissionHeaderHeight(Math.round(missionHeader.getBoundingClientRect().height));
    };

    updateMissionHeaderHeight();

    const observer = new ResizeObserver(updateMissionHeaderHeight);
    observer.observe(missionHeader);

    return () => observer.disconnect();
  }, [theme, runId, status, runSource, isMissionHeaderPinned]);

  useEffect(() => {
    const missionHeaderContainer = missionHeaderContainerRef.current;
    if (!missionHeaderContainer) {
      return;
    }

    const stickyTop = 12;
    const updatePinnedState = () => {
      const nextPinned = missionHeaderContainer.getBoundingClientRect().top <= stickyTop;
      setIsMissionHeaderPinned((previous) => (previous === nextPinned ? previous : nextPinned));
    };

    updatePinnedState();
    window.addEventListener("scroll", updatePinnedState, { passive: true });
    window.addEventListener("resize", updatePinnedState);

    return () => {
      window.removeEventListener("scroll", updatePinnedState);
      window.removeEventListener("resize", updatePinnedState);
    };
  }, []);

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
              const isActive = item.id === "home";
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`mission-menu-button mission-menu-button-compact ${isActive ? "mission-menu-button-active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
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
              title={theme === "night" ? "Day mode" : "Night mode"}
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
                const isActive = item.id === "home";
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mission-menu-button ${isActive ? "mission-menu-button-active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
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
              title={theme === "night" ? "Day mode" : "Night mode"}
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
        <AgentRoster
          activeAgent={activeAgent}
          agents={rosterAgents}
          collapsed={sidebarCollapsed}
          enabledAgents={enabledAgents}
          eventCounts={agentEventCounts}
          highlightedTask={highlightedTask}
          liveMetrics={liveMetrics}
          onSelectAgent={setActiveAgent}
          onToggle={() => setSidebarCollapsed((c) => !c)}
          onToggleAgent={handleToggleAgent}
          running={status === "running"}
          runSource={runSource}
          selectedAgentSummary={selectedAgentSummary}
          statusByAgent={agentStatuses}
        />
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
              style={{ left: sidebarCollapsed ? 56 : 300 }}
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
          isMockActive={runSource === "mock"}
          onLoadMock={handleLoadMock}
          onQueryChange={setDraftQuery}
          onRun={handleRun}
          query={draftQuery}
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
      </main>
    </div>
  );
}
