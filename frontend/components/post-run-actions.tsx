"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CalendarClock, CheckCircle2, Loader2, Mail, Ticket, X } from "lucide-react";
import type { ToastLevel } from "@/components/toast";
import type {
  ExecutePostRunActionResponse,
  PostRunAction,
  PostRunActionType,
  PostRunActionsResponse,
  RunSource,
  RunStatus,
} from "@/lib/types";

interface PostRunActionsProps {
  result: string;
  runId?: string | null;
  runSource: RunSource;
  status: RunStatus;
  onNotify?: (message: string, level: ToastLevel) => void;
}

interface FieldConfig {
  key: string;
  label: string;
  multiline?: boolean;
  readOnly?: boolean;
}

const ACTION_ICONS: Record<PostRunActionType, typeof Mail> = {
  schedule_maintenance: CalendarClock,
  create_support_ticket: Ticket,
  send_email: Mail,
};

const ACTION_CTA: Record<PostRunActionType, string> = {
  schedule_maintenance: "Review & schedule",
  create_support_ticket: "Review ticket",
  send_email: "Review email",
};

function actionFields(type: PostRunActionType): FieldConfig[] {
  if (type === "send_email") {
    return [
      { key: "recipient", label: "Recipient", readOnly: true },
      { key: "subject", label: "Subject" },
      { key: "body", label: "Body", multiline: true },
    ];
  }
  if (type === "create_support_ticket") {
    return [
      { key: "title", label: "Title" },
      { key: "priority", label: "Priority" },
      { key: "asset_id", label: "Asset" },
      { key: "description", label: "Description", multiline: true },
    ];
  }
  return [
    { key: "asset_id", label: "Asset" },
    { key: "priority", label: "Priority" },
    { key: "requested_timing", label: "Requested timing" },
    { key: "summary", label: "Work summary", multiline: true },
  ];
}

function stringifyDraft(draft: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [key, typeof value === "string" ? value : String(value ?? "")]),
  );
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json();
    if (body && typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    // The proxy may return an empty or non-JSON body for network failures.
  }
  return fallback;
}

export function PostRunActions({ result, runId, runSource, status, onNotify }: PostRunActionsProps) {
  const [actionsResponse, setActionsResponse] = useState<PostRunActionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedAction, setSelectedAction] = useState<PostRunAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const shouldShow = status === "done" && Boolean(result) && Boolean(runId) && runSource !== "mock";

  const loadActions = useCallback(
    async (signal?: AbortSignal) => {
      if (!runId) return;
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch(`/api/post-run-actions/${encodeURIComponent(runId)}`, {
          cache: "no-store",
          signal,
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Post-run actions are unavailable for this run."));
        }
        setActionsResponse((await response.json()) as PostRunActionsResponse);
      } catch (error) {
        if (signal?.aborted) return;
        const message = error instanceof Error ? error.message : "Post-run actions are unavailable for this run.";
        setLoadError(message);
        setActionsResponse(null);
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [runId],
  );

  useEffect(() => {
    if (!shouldShow) {
      setActionsResponse(null);
      setLoadError("");
      setLoading(false);
      setSelectedAction(null);
      return;
    }

    const abortController = new AbortController();
    void loadActions(abortController.signal);
    return () => abortController.abort();
  }, [loadActions, shouldShow]);

  const submitAction = useCallback(
    async (action: PostRunAction, payload: Record<string, string>) => {
      if (!runId) return;
      setSubmitting(true);
      setSubmitError("");
      try {
        const response = await fetch(`/api/post-run-actions/${encodeURIComponent(runId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action_type: action.type, payload }),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Post-run action failed."));
        }
        const data = (await response.json()) as ExecutePostRunActionResponse;
        onNotify?.(data.message, "success");
        setSelectedAction(null);
        await loadActions();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Post-run action failed.";
        setSubmitError(message);
        onNotify?.(message, "error");
      } finally {
        setSubmitting(false);
      }
    },
    [loadActions, onNotify, runId],
  );

  if (!shouldShow) {
    return null;
  }

  return (
    <section className="post-run-actions" aria-labelledby="post-run-actions-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Next steps</p>
          <h3 id="post-run-actions-title" className="mt-2 text-base font-semibold text-[var(--text-primary)]">
            Recommended next actions
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Turn this finding into an operational follow-up without rerunning the agents.
          </p>
        </div>
        {actionsResponse ? <span className="post-run-actions-badge">{actionsResponse.result_title}</span> : null}
      </div>

      {loading ? (
        <div className="post-run-actions-state">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading available actions...
        </div>
      ) : loadError ? (
        <div className="post-run-actions-state post-run-actions-state-error">
          <AlertCircle className="h-4 w-4" />
          <span>{loadError}</span>
          <button type="button" className="secondary-button secondary-button-compact" onClick={() => loadActions()}>
            Retry
          </button>
        </div>
      ) : actionsResponse ? (
        <div className="post-run-action-grid">
          {actionsResponse.actions.map((action) => (
            <PostRunActionCard
              action={action}
              key={action.type}
              onSelect={() => {
                setSubmitError("");
                setSelectedAction(action);
              }}
            />
          ))}
        </div>
      ) : null}

      <AnimatePresence>
        {selectedAction ? (
          <PostRunActionModal
            action={selectedAction}
            error={submitError}
            onClose={() => {
              if (!submitting) {
                setSelectedAction(null);
                setSubmitError("");
              }
            }}
            onSubmit={submitAction}
            submitting={submitting}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function PostRunActionCard({ action, onSelect }: { action: PostRunAction; onSelect: () => void }) {
  const Icon = ACTION_ICONS[action.type];
  const succeeded = Boolean(action.latest_submission);
  const priorityClass = action.priority === "urgent" ? "post-run-action-card-urgent" : "";

  return (
    <button
      type="button"
      className={`post-run-action-card ${priorityClass}`}
      disabled={!action.enabled}
      onClick={onSelect}
    >
      <span className="post-run-action-icon">
        <Icon className="h-4 w-4" />
      </span>
      <span className="post-run-action-content">
        <span className="post-run-action-title-row">
          <span className="post-run-action-title">{action.label}</span>
          <span className={`post-run-action-priority post-run-action-priority-${action.priority}`}>
            {action.priority}
          </span>
        </span>
        <span className="post-run-action-description">{action.description}</span>
        {succeeded && action.latest_submission ? (
          <span className="post-run-action-status">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {action.latest_submission.message}
          </span>
        ) : null}
        <span className="post-run-action-cta">{succeeded ? "Submit again" : ACTION_CTA[action.type]}</span>
      </span>
    </button>
  );
}

function PostRunActionModal({
  action,
  error,
  onClose,
  onSubmit,
  submitting,
}: {
  action: PostRunAction;
  error: string;
  onClose: () => void;
  onSubmit: (action: PostRunAction, payload: Record<string, string>) => Promise<void>;
  submitting: boolean;
}) {
  const [payload, setPayload] = useState<Record<string, string>>(() => stringifyDraft(action.draft));
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const fields = useMemo(() => actionFields(action.type), [action.type]);
  const Icon = ACTION_ICONS[action.type];

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  return (
    <motion.div
      className="fixed inset-0 z-[210] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={submitting ? undefined : onClose} aria-hidden="true" />

      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={action.label}
        className="post-run-action-dialog"
        initial={{ opacity: 0, scale: 0.96, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 18 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <div className="post-run-action-dialog-header">
          <div className="flex items-center gap-2.5">
            <span className="post-run-action-icon">
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">{action.label}</h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{action.description}</p>
            </div>
          </div>
          <button type="button" className="secondary-button secondary-button-compact" onClick={onClose} disabled={submitting} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="post-run-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(action, payload);
          }}
        >
          {fields.map((field) => (
            <label className="post-run-action-field" key={field.key}>
              <span>{field.label}</span>
              {field.multiline ? (
                <textarea
                  value={payload[field.key] ?? ""}
                  readOnly={field.readOnly || submitting}
                  onChange={(event) => setPayload((current) => ({ ...current, [field.key]: event.target.value }))}
                  rows={field.key === "body" || field.key === "description" ? 8 : 5}
                />
              ) : (
                <input
                  value={payload[field.key] ?? ""}
                  readOnly={field.readOnly || submitting}
                  onChange={(event) => setPayload((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              )}
            </label>
          ))}

          {error ? (
            <div className="post-run-action-submit-error">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          ) : null}

          <div className="post-run-action-dialog-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="action-button" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {action.type === "schedule_maintenance"
                ? "Schedule maintenance"
                : action.type === "create_support_ticket"
                  ? "Create ticket"
                  : "Send email"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
