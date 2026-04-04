"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronDown, Factory, FlaskConical, LoaderCircle, Send, Wrench, type LucideIcon } from "lucide-react";
import { STARTER_PROMPTS } from "@/lib/starter-prompts";

export type ReasoningEffort = "high" | "medium" | "low" | "none";

const STARTER_ICONS: Record<string, LucideIcon> = { Wrench, Factory };

interface QueryComposerProps {
  collapseMode: "idle" | "running" | "settled" | "mock";
  condensedStateLabel: string;
  disabled: boolean;
  isMockActive: boolean;
  onLoadMock: () => void;
  onQueryChange: (query: string) => void;
  query: string;
  onRun: (query: string) => void;
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
}

const REASONING_OPTIONS: { value: ReasoningEffort; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "No extended reasoning" },
  { value: "low", label: "Low", hint: "Fast" },
  { value: "medium", label: "Med", hint: "Balanced" },
  { value: "high", label: "High", hint: "Best quality" },
];

export function QueryComposer({
  collapseMode,
  condensedStateLabel,
  disabled,
  isMockActive,
  onLoadMock,
  onQueryChange,
  query,
  onRun,
  reasoningEffort,
  onReasoningEffortChange,
}: QueryComposerProps) {
  const [isCondensed, setIsCondensed] = useState(false);

  useEffect(() => {
    setIsCondensed(collapseMode !== "idle");
  }, [collapseMode]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();

    if (!trimmed || disabled) {
      return;
    }

    onRun(trimmed);
  };

  const condensedSummary = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return "No mission brief entered yet.";
    }
    return trimmed.replace(/\s+/g, " ");
  }, [query]);

  return (
    <section className={`panel-shell query-shell ${isCondensed ? "px-3 py-2.5 sm:px-4 sm:py-3" : "px-3 py-3 sm:px-5 sm:py-5"}`}>
      <form onSubmit={handleSubmit} className={isCondensed ? "" : "space-y-4"}>
        {!isCondensed ? (
          <div className="max-w-2xl">
            <p className="eyebrow">Mission brief</p>
            <h2 className="section-title mt-2">Describe the task for the agent system</h2>
            <p className="section-copy mt-2">
              Describe the task for the multi-agent system. Be specific when it comes to details or problem description.
            </p>
          </div>
        ) : null}

        {isCondensed ? (
          <div className="rounded-[10px] border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Mission brief saved</p>
                <p className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]">{condensedSummary}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className={`live-pill${collapseMode === "running" ? " status-chip-streaming" : ""}`}>{condensedStateLabel}</span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsCondensed(false)}
                  aria-expanded="false"
                  aria-label="Expand mission brief"
                >
                  <ChevronDown className="h-4 w-4 rotate-180" />
                  Expand
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex min-h-28 w-full flex-col">
                <textarea
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  disabled={disabled}
                  rows={4}
                  className="field-shell query-shell-textarea min-h-28 w-full resize-y"
                  placeholder="Describe the task for the orchestrator and specialist agents."
                />
              </div>

              <div className="flex shrink-0 flex-col gap-2 xl:w-[13.5rem]">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Reasoning</span>
                  <div className="reasoning-toggle-group">
                    {REASONING_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        title={opt.hint}
                        disabled={disabled}
                        aria-pressed={reasoningEffort === opt.value}
                        onClick={() => onReasoningEffortChange(opt.value)}
                        className={`reasoning-toggle-button ${reasoningEffort === opt.value ? "reasoning-toggle-button-active" : ""}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button type="submit" disabled={disabled || !query.trim()} className="action-button w-full">
                  {disabled ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {disabled ? "Streaming" : "Launch mission"}
                </button>

                <button type="button" disabled={disabled} className="secondary-button w-full" onClick={onLoadMock}>
                  <FlaskConical className="h-4 w-4" />
                  {isMockActive ? "Reload mock" : "Load mock replay"}
                </button>

                {disabled ? (
                  <button
                    type="button"
                    className="secondary-button w-full"
                    onClick={() => setIsCondensed(true)}
                    aria-expanded="true"
                    aria-label="Collapse mission brief"
                  >
                    <ChevronDown className="h-4 w-4" />
                    Collapse
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((prompt) => {
                const Icon = STARTER_ICONS[prompt.icon];
                return (
                  <button
                    key={prompt.title}
                    type="button"
                    title={prompt.query}
                    aria-label={`${prompt.title}. ${prompt.query}`}
                    onClick={() => onQueryChange(prompt.query)}
                    disabled={disabled}
                    className="starter-pill"
                  >
                    <span className="flex items-start gap-2.5 text-left">
                      {Icon && <Icon className="starter-pill-icon" />}
                      <span className="flex flex-col gap-1">
                        <span className="starter-pill-title">{prompt.title}</span>
                        <span className="starter-pill-copy">{prompt.subtitle}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </form>
    </section>
  );
}
