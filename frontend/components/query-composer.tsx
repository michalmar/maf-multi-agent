"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronDown, FlaskConical, LoaderCircle, Send } from "lucide-react";
import { STARTER_PROMPTS } from "@/lib/starter-prompts";

interface QueryComposerProps {
  collapseMode: "idle" | "running" | "settled" | "mock";
  condensedStateLabel: string;
  disabled: boolean;
  isMockActive: boolean;
  onLoadMock: () => void;
  onQueryChange: (query: string) => void;
  query: string;
  onRun: (query: string) => void;
}

const MAX_QUERY_LENGTH = 900;

export function QueryComposer({
  collapseMode,
  condensedStateLabel,
  disabled,
  isMockActive,
  onLoadMock,
  onQueryChange,
  query,
  onRun,
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
    <section className={`panel-shell query-shell ${isCondensed ? "px-4 py-3 sm:px-5 sm:py-4" : "px-4 py-4 sm:px-6 sm:py-6"}`}>
      <form onSubmit={handleSubmit} className={isCondensed ? "" : "space-y-5"}>
        {!isCondensed ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="eyebrow">Mission brief</p>
              <h2 className="section-title mt-2">Describe the task for the agent system</h2>
              <p className="section-copy mt-2">
                Keep the workflow identical while giving the interface a cleaner command surface for live runs, mock replays, and final output review.
              </p>
            </div>

            <div className="metric-inline min-w-[10rem]">
              <span className="metric-inline-label">Characters</span>
              <span className="font-mono text-sm text-[var(--text-primary)]">
                {query.length}/{MAX_QUERY_LENGTH}
              </span>
            </div>
          </div>
        ) : null}

        {isCondensed ? (
          <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Mission brief saved</p>
                <p className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]">{condensedSummary}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="live-pill">{condensedStateLabel}</span>
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
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
              <textarea
                value={query}
                onChange={(event) => onQueryChange(event.target.value.slice(0, MAX_QUERY_LENGTH))}
                disabled={disabled}
                rows={5}
                maxLength={MAX_QUERY_LENGTH}
                className="field-shell query-shell-textarea min-h-36 w-full resize-y"
                placeholder="Describe the task for the orchestrator and specialist agents."
              />

              <div className="flex shrink-0 flex-col gap-2 xl:w-[13.5rem]">
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
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt.title}
                  type="button"
                  title={prompt.query}
                  aria-label={`${prompt.title}. ${prompt.query}`}
                  onClick={() => onQueryChange(prompt.query)}
                  disabled={disabled}
                  className="starter-pill"
                >
                  <span className="flex flex-col items-start gap-1 text-left">
                    <span className="starter-pill-title">{prompt.title}</span>
                    <span className="starter-pill-copy">{prompt.subtitle}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </form>
    </section>
  );
}
