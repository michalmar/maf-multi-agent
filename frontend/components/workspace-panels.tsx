"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, FileText, GitCompare, Radio, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ActivityFeed } from "@/components/activity-feed";
import { AgentEvent, DocumentVersion, RunStatus, WorkspaceTab } from "@/lib/types";

interface WorkspacePanelsProps {
  activeAgent: string | null;
  activeTab: WorkspaceTab;
  documents: DocumentVersion[];
  events: AgentEvent[];
  highlightedTask: number | null;
  result: string;
  running: boolean;
  status: RunStatus;
  onTabChange: (tab: WorkspaceTab) => void;
}

interface DiffLine {
  type: "same" | "add" | "remove";
  text: string;
}

function buildDiff(previous: string, current: string): DiffLine[] {
  if (!previous) {
    return current.split("\n").map((line) => ({ type: "add", text: line }));
  }

  const previousLines = previous.split("\n");
  const currentLines = current.split("\n");
  const maxLength = Math.max(previousLines.length, currentLines.length);
  const diff: DiffLine[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const oldLine = previousLines[index];
    const newLine = currentLines[index];

    if (oldLine === undefined) {
      diff.push({ type: "add", text: newLine });
      continue;
    }

    if (newLine === undefined) {
      diff.push({ type: "remove", text: oldLine });
      continue;
    }

    if (oldLine === newLine) {
      diff.push({ type: "same", text: oldLine });
      continue;
    }

    diff.push({ type: "remove", text: oldLine });
    diff.push({ type: "add", text: newLine });
  }

  return diff;
}

function ClipboardButton({ onCopy, copied }: { onCopy: () => Promise<void>; copied: boolean }) {
  return (
    <button type="button" className="secondary-button" onClick={onCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function WorkspacePanels({
  activeAgent,
  activeTab,
  documents,
  events,
  highlightedTask,
  result,
  running,
  status,
  onTabChange,
}: WorkspacePanelsProps) {
  const [selectedDocumentIndex, setSelectedDocumentIndex] = useState<number | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<"document" | "result" | null>(null);

  const tabs = [
    { id: "activity" as const, label: "Activity", icon: Radio, badge: events.filter((event) => event.event_type !== "agent_streaming").length },
    { id: "document" as const, label: "Document", icon: FileText, badge: documents.length },
    { id: "result" as const, label: "Result", icon: Sparkles, badge: result ? 1 : 0 },
  ];

  const currentDocumentIndex = selectedDocumentIndex ?? Math.max(documents.length - 1, 0);
  const currentDocument = documents[currentDocumentIndex];
  const previousDocument = currentDocumentIndex > 0 ? documents[currentDocumentIndex - 1] : null;

  const diffLines = useMemo(() => {
    if (!currentDocument || !previousDocument) {
      return [];
    }
    return buildDiff(previousDocument.content, currentDocument.content);
  }, [currentDocument, previousDocument]);

  const copyText = async (value: string, target: "document" | "result") => {
    await navigator.clipboard.writeText(value);
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget((current) => (current === target ? null : current)), 1600);
  };

  const downloadResult = () => {
    const blob = new Blob([result], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mission-result.md";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel-shell p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(183,193,212,0.14)] pb-4">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2 className="section-title mt-2">Evidence, drafts, and final output</h2>
          <p className="section-copy mt-2 max-w-2xl">
            Review activity, inspect draft revisions, and read the final markdown output without changing any of the underlying orchestration behavior.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`tab-pill ${active ? "tab-pill-active" : ""}`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {tab.badge ? <span className="tab-pill-badge">{tab.badge > 99 ? "99+" : tab.badge}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 min-h-[34rem]">
        {activeTab === "activity" ? (
          <ActivityFeed
            activeAgent={activeAgent}
            events={events}
            highlightedTask={highlightedTask}
            running={running}
          />
        ) : null}

        {activeTab === "document" ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {documents.length > 0 ? (
                  documents.map((document, index) => {
                    const active = currentDocumentIndex === index;
                    return (
                      <button
                        key={`${document.version}-${index}`}
                        type="button"
                        onClick={() => {
                          setSelectedDocumentIndex(index);
                          setShowDiff(false);
                        }}
                        className={`filter-pill ${active ? "filter-pill-active" : ""}`}
                      >
                        {document.version === "final" ? "Final" : `v${document.version}`}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-sm text-[var(--text-secondary)]">No document versions have streamed yet.</span>
                )}
              </div>

              {currentDocument ? (
                <div className="flex flex-wrap gap-2">
                  {previousDocument ? (
                    <button type="button" className="secondary-button" onClick={() => setShowDiff((current) => !current)}>
                      <GitCompare className="h-4 w-4" />
                      {showDiff ? "Hide diff" : "Show diff"}
                    </button>
                  ) : null}
                  <ClipboardButton
                    copied={copiedTarget === "document"}
                    onCopy={() => copyText(currentDocument.content, "document")}
                  />
                </div>
              ) : null}
            </div>

            {currentDocument ? (
               <div className="workspace-surface">
                 {showDiff && previousDocument ? (
                   <div className="overflow-x-auto font-mono text-xs leading-7 text-[var(--text-secondary)]">
                    {diffLines.map((line, index) => (
                      <div
                        key={`${line.type}-${index}`}
                        className="flex gap-3 px-4 py-1.5"
                        style={{
                          background:
                            line.type === "add"
                              ? "rgba(133, 212, 174, 0.10)"
                              : line.type === "remove"
                                ? "rgba(243, 139, 139, 0.10)"
                                : "transparent",
                        }}
                      >
                        <span className="w-4 shrink-0 text-[var(--text-muted)]">
                          {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                        </span>
                        <span className="whitespace-pre-wrap">{line.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap p-6 text-sm leading-7 text-[var(--text-secondary)]">
                    {currentDocument.content}
                  </pre>
                )}
              </div>
            ) : (
              <div className="workspace-empty">Document revisions will appear here as agents update the shared draft.</div>
            )}
          </div>
        ) : null}

        {activeTab === "result" ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--text-secondary)]">
                {status === "done"
                  ? "The orchestrator has produced a final response."
                  : "The final response will settle here once the mission completes."}
              </p>

              {result ? (
                <div className="flex flex-wrap gap-2">
                  <ClipboardButton copied={copiedTarget === "result"} onCopy={() => copyText(result, "result")} />
                  <button type="button" className="secondary-button" onClick={downloadResult}>
                    <Download className="h-4 w-4" />
                    Download
                  </button>
                </div>
              ) : null}
            </div>

            {result ? (
               <div className="workspace-surface px-6 py-6">
                 <div className="prose-report max-w-none">
                   <ReactMarkdown>{result}</ReactMarkdown>
                 </div>
              </div>
            ) : (
              <div className="workspace-empty">The markdown result will render here after the output event arrives.</div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
