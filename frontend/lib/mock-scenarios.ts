import { AgentDefinition, AgentEvent, DocumentVersion, TaskItem } from "@/lib/types";

interface MockScenario {
  agents: AgentDefinition[];
  documents: DocumentVersion[];
  events: AgentEvent[];
  query: string;
  result: string;
  runId: string;
  streamLabel: string;
  tasks: TaskItem[];
}

interface TaskBlueprint {
  completion: string;
  id: number;
  noteAction: string;
  noteTitle: string;
  assigned_to: string;
  text: string;
  elapsed: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

const MAINTENANCE_QUERY =
  "Assess the health of Emerson gas compressor COMP-001 in Houston, Texas. Use the Fabric data sources to identify any abnormal operating patterns, check the vendor maintenance guide PDF to determine whether the behavior breaches advisory or alarm thresholds, and use external context if relevant. Then summarize the issue, likely cause, confidence level, and recommended next maintenance action.";

const MOCK_AGENTS: AgentDefinition[] = [
  {
    name: "orchestrator",
    display_name: "Orchestrator",
    avatar: "✦",
    role: "Facilitator & coordinator",
    model: "gpt-5.1",
    description: "Coordinates the investigation, stages tool use, and synthesizes the maintenance brief.",
  },
  {
    name: "coder_tool",
    display_name: "Coder Agent",
    avatar: "⌘",
    role: "Fabric query specialist",
    model: "gpt-5.1-mini",
    description: "Builds the telemetry queries and pulls the most relevant operational windows for inspection.",
  },
  {
    name: "kb_tool",
    display_name: "KB Agent",
    avatar: "☰",
    role: "Guide interpreter",
    model: "gpt-5.1-mini",
    description: "Extracts maintenance thresholds from vendor documentation and service manuals.",
  },
  {
    name: "data_analyst_tool",
    display_name: "Data Analyst",
    avatar: "◫",
    role: "Trend analyst",
    model: "gpt-5.1-mini",
    description: "Correlates pressure, vibration, and thermal deviations into a coherent health narrative.",
  },
  {
    name: "websearch_tool",
    display_name: "WebSearch Agent",
    avatar: "◌",
    role: "External context",
    model: "gpt-5.1-mini",
    description: "Adds field guidance and known compressor-failure patterns from public reference material.",
  },
];

const TASK_BLUEPRINTS: TaskBlueprint[] = [
  {
    id: 1,
    assigned_to: "coder_tool",
    text: "Pull the last 72 hours of compressor telemetry and isolate the abnormal operating window around the latest warning pattern.",
    completion:
      "Collected Fabric telemetry for suction pressure, discharge temperature, motor current, and vibration. The abnormal cluster starts at 03:14 local time with repeated high-discharge temperature spikes and a small but persistent vibration lift.",
    noteAction: "seed timeline",
    noteTitle: "Telemetry window isolated",
    elapsed: 35.2,
    usage: { input_tokens: 905, output_tokens: 418, total_tokens: 1323 },
  },
  {
    id: 2,
    assigned_to: "data_analyst_tool",
    text: "Quantify whether the pattern is stable drift or a step-change event, and identify the most likely lead indicator.",
    completion:
      "The signal is a step-change rather than a slow drift. Discharge temperature leads the event by roughly nine minutes, followed by vibration and then a minor current rise, which suggests cooling degradation or recirculation before mechanical stress becomes visible.",
    noteAction: "append analysis",
    noteTitle: "Lead indicator identified",
    elapsed: 41.8,
    usage: { input_tokens: 1124, output_tokens: 504, total_tokens: 1628 },
  },
  {
    id: 3,
    assigned_to: "kb_tool",
    text: "Read the vendor maintenance guide and map the observed values against advisory and alarm thresholds for Emerson compressor hardware.",
    completion:
      "The maintenance guide flags sustained discharge temperature above the advisory band and repeated vibration growth near the alarm floor as a combined precursor pattern. The observed values breach advisory guidance and approach the alarm threshold when the unit is under peak load.",
    noteAction: "compare thresholds",
    noteTitle: "Guide thresholds mapped",
    elapsed: 33.5,
    usage: { input_tokens: 998, output_tokens: 376, total_tokens: 1374 },
  },
  {
    id: 4,
    assigned_to: "websearch_tool",
    text: "Gather external context on compressor overheating and recirculation patterns that match this signal shape.",
    completion:
      "External references point to cooler fouling, suction restriction, or recycle valve instability as the most common causes for this signal shape. The closest match is cooler performance degradation because the temperature rise precedes the vibration increase and current stays comparatively stable.",
    noteAction: "add field context",
    noteTitle: "External context added",
    elapsed: 29.7,
    usage: { input_tokens: 874, output_tokens: 341, total_tokens: 1215 },
  },
  {
    id: 5,
    assigned_to: "coder_tool",
    text: "Prepare a concise asset status note covering the anomaly window, severity, and likely root-cause cluster.",
    completion:
      "Prepared a structured status note: anomaly is active, severity is medium-high, and the root-cause cluster currently favors cooling inefficiency with secondary attention on recycle instability.",
    noteAction: "draft asset note",
    noteTitle: "Asset note drafted",
    elapsed: 26.4,
    usage: { input_tokens: 761, output_tokens: 289, total_tokens: 1050 },
  },
  {
    id: 6,
    assigned_to: "kb_tool",
    text: "Recommend the next maintenance action with a confidence estimate and any safety caveats that operations should note.",
    completion:
      "Recommended near-term inspection of the cooler path and recycle-valve behavior before the next high-load cycle. Confidence is moderate-high because the guide alignment and external field pattern both support the same direction. Safety caveat: avoid sustained peak loading until the inspection confirms margin.",
    noteAction: "recommend action",
    noteTitle: "Recommended action added",
    elapsed: 31.1,
    usage: { input_tokens: 842, output_tokens: 364, total_tokens: 1206 },
  },
];

function buildDocumentSnapshots(): DocumentVersion[] {
  return [
    {
      version: 1,
      action: "seed timeline",
      content: [
        "# COMP-001 health assessment",
        "",
        "## Working notes",
        "- Abnormal telemetry window isolated between 03:14 and 04:06 local time.",
        "- Initial indicators: discharge temperature spikes, light vibration growth, stable but slightly elevated current draw.",
      ].join("\n"),
    },
    {
      version: 2,
      action: "append analysis",
      content: [
        "# COMP-001 health assessment",
        "",
        "## Working notes",
        "- Abnormal telemetry window isolated between 03:14 and 04:06 local time.",
        "- Step-change pattern confirmed rather than slow drift.",
        "- Discharge temperature is the earliest reliable lead indicator.",
      ].join("\n"),
    },
    {
      version: 3,
      action: "compare thresholds",
      content: [
        "# COMP-001 health assessment",
        "",
        "## Working notes",
        "- Step-change pattern confirmed rather than slow drift.",
        "- Discharge temperature is the earliest reliable lead indicator.",
        "- Vendor guide: observed temperature is inside the advisory breach band and approaches the alarm floor under load.",
      ].join("\n"),
    },
    {
      version: 4,
      action: "add field context",
      content: [
        "# COMP-001 health assessment",
        "",
        "## Working notes",
        "- External references point to cooler fouling or recycle instability as the dominant failure family.",
        "- Current draw remains too stable for an immediate mechanical seizure hypothesis.",
        "- Field evidence strengthens the cooling-path explanation.",
      ].join("\n"),
    },
    {
      version: 5,
      action: "draft asset note",
      content: [
        "# COMP-001 health assessment",
        "",
        "## Interim assessment",
        "- Asset status: abnormal but still operable with caution.",
        "- Severity: medium-high because the anomaly is persistent and approaching alarm guidance under peak load.",
        "- Likely cause cluster: cooler performance degradation, with recycle instability as a secondary branch.",
      ].join("\n"),
    },
    {
      version: 6,
      action: "recommend action",
      content: [
        "# COMP-001 health assessment",
        "",
        "## Interim assessment",
        "- Severity: medium-high because the anomaly is persistent and approaching alarm guidance under peak load.",
        "- Likely cause cluster: cooler performance degradation, with recycle instability as a secondary branch.",
        "- Recommended next action: inspect cooler path and recycle valve behavior before the next high-load cycle.",
      ].join("\n"),
    },
    {
      version: 7,
      action: "consolidate brief",
      content: [
        "# COMP-001 health assessment",
        "",
        "## Executive summary",
        "- The compressor shows a repeatable overheating pattern with a follow-on vibration rise.",
        "- Current evidence supports a cooling-path issue more strongly than a direct rotating-element failure.",
        "- Advisory thresholds are breached and alarm proximity narrows during peak load.",
        "",
        "## Recommended next step",
        "Schedule a near-term inspection of the cooler path and recycle valve, and reduce sustained peak loading until the inspection is complete.",
      ].join("\n"),
    },
  ];
}

function buildFinalResult(): string {
  return [
    "# COMP-001 maintenance brief",
    "",
    "## Health status",
    "COMP-001 is showing a **medium-high severity abnormal condition**. The compressor is still operable, but the current trend should not be treated as benign drift.",
    "",
    "## What changed",
    "- A clear step-change begins around `03:14` local time.",
    "- Discharge temperature rises first, then vibration follows, while motor current remains comparatively stable.",
    "- That sequence makes a cooling-path or recirculation issue more plausible than an immediate hard mechanical fault.",
    "",
    "## Threshold check",
    "The Emerson maintenance guidance places the observed discharge temperature inside the advisory breach band and shows the vibration trend moving close to the alarm floor under high load.",
    "",
    "## Likely cause",
    "The most likely cause is **cooler performance degradation**, with **recycle valve instability** as the secondary hypothesis.",
    "",
    "## Confidence",
    "**Moderate-high**. The telemetry sequence, vendor-threshold comparison, and external field context point in the same direction.",
    "",
    "## Recommended next maintenance action",
    "Inspect the cooler path and recycle valve before the next sustained high-load cycle. Until then, avoid extended peak-loading periods and keep the asset under closer operational watch.",
  ].join("\n");
}

function cloneTasks(tasks: TaskItem[]) {
  return tasks.map((task) => ({ ...task }));
}

export function getMaintenanceMockScenario(): MockScenario {
  const tasks: TaskItem[] = TASK_BLUEPRINTS.map(({ id, text, assigned_to }) => ({
    id,
    text,
    assigned_to,
    finished: false,
  }));

  const documentSnapshots = buildDocumentSnapshots();
  const finalResult = buildFinalResult();
  const finalDocument = [
    documentSnapshots[documentSnapshots.length - 1].content,
    "",
    "## Confidence",
    "Moderate-high. The signal ordering, guide thresholds, and external pattern match all reinforce the same diagnosis.",
  ].join("\n");

  const documents: DocumentVersion[] = [
    ...documentSnapshots,
    { version: "final", action: "final", content: finalDocument },
  ];

  const baseTimestamp = Math.floor(Date.now() / 1000) - 16 * 60;
  let offset = 0;
  const createEvent = (event_type: string, source: string, data: AgentEvent["data"], step = 18): AgentEvent => {
    const event: AgentEvent = {
      event_type,
      source,
      data,
      timestamp: baseTimestamp + offset,
    };
    offset += step;
    return event;
  };

  const events: AgentEvent[] = [
    createEvent("workflow_started", "orchestrator", { query: MAINTENANCE_QUERY }),
    createEvent("reasoning", "orchestrator", {
      text: "Use a maintenance-triage structure: isolate the anomaly window, compare the signals to the guide thresholds, then synthesize the most likely root-cause branch and next action.",
    }),
    createEvent("tool_decision", "orchestrator", {
      tool: "create_tasks",
      arguments: {
        dispatch_plan: TASK_BLUEPRINTS.map(({ id, assigned_to, text }) => ({ id, assigned_to, text })),
      },
    }),
    createEvent("tasks_created", "taskboard", { tasks: cloneTasks(tasks) }),
    createEvent("reasoning", "orchestrator", {
      text: "Start with telemetry extraction and trend analysis so the documentation and external context can be grounded in the actual anomaly window.",
    }),
    createEvent("tool_decision", "orchestrator", {
      tool: "dispatch_batch",
      arguments: { task_ids: [1, 2, 3, 4, 5, 6] },
    }),
  ];

  TASK_BLUEPRINTS.forEach((blueprint, index) => {
    events.push(
      createEvent("tool_decision", "orchestrator", {
        tool: `dispatch_${blueprint.assigned_to}`,
        arguments: { task_id: blueprint.id, assignee: blueprint.assigned_to },
      }),
    );
    events.push(
      createEvent("agent_started", blueprint.assigned_to, {
        agent_name: blueprint.assigned_to,
        task_id: blueprint.id,
      }),
    );
    events.push(
      createEvent("agent_completed", blueprint.assigned_to, {
        result: blueprint.completion,
        elapsed: blueprint.elapsed,
        length: blueprint.completion.length,
        usage: blueprint.usage,
        task_id: blueprint.id,
      }),
    );
    events.push(
      createEvent("document_updated", blueprint.assigned_to, {
        version: index + 1,
        content: documentSnapshots[index].content,
        history: { action: blueprint.noteAction, title: blueprint.noteTitle },
      }),
    );

    tasks[index] = { ...tasks[index], finished: true };
    events.push(
      createEvent("task_completed", "taskboard", {
        task_id: blueprint.id,
        tasks: cloneTasks(tasks),
      }),
    );
  });

  events.push(
    createEvent("reasoning", "orchestrator", {
      text: "All six specialist tasks have landed. Consolidate the notes into a concise maintenance brief with severity, diagnosis, confidence, and next action.",
    }),
    createEvent("tool_decision", "orchestrator", {
      tool: "read_document",
      arguments: { version: 6, purpose: "consolidate_brief" },
    }),
    createEvent("document_updated", "orchestrator", {
      version: 7,
      content: documentSnapshots[6].content,
      history: { action: "consolidate brief", title: "Executive summary added" },
    }),
    createEvent("reasoning", "orchestrator", {
      text: "The strongest explanation remains cooler degradation. Keep recycle instability in the recommendation set, but do not overstate it.",
    }),
    createEvent("tool_decision", "orchestrator", {
      tool: "synthesize_result",
      arguments: { include_sections: ["health_status", "threshold_check", "likely_cause", "confidence", "next_action"] },
    }),
    createEvent("reasoning", "orchestrator", {
      text: "Final pass complete. The brief is concise, actionable, and traces each claim back to a collected signal or threshold source.",
    }),
    createEvent("reasoning", "orchestrator", {
      text: "Emit the final response and keep the full working document available for inspection in the UI.",
    }),
    createEvent("tool_decision", "orchestrator", {
      tool: "emit_final_output",
      arguments: { result_length: finalResult.length, document_versions: documents.length },
    }),
    createEvent("workflow_completed", "orchestrator", {
      elapsed: 542.6,
      tasks_completed: "6/6 tasks completed.",
      document_version: 7,
      response_length: finalResult.length,
    }),
    createEvent("output", "orchestrator", {
      text: finalResult,
      document: finalDocument,
    }),
  );

  return {
    agents: MOCK_AGENTS,
    documents,
    events,
    query: MAINTENANCE_QUERY,
    result: finalResult,
    runId: "mock-maint-20260314-073054",
    streamLabel: "Mock maintenance replay loaded from a completed run style fixture. No backend calls required.",
    tasks: cloneTasks(tasks),
  };
}
