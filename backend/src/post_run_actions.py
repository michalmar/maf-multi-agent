"""Post-run action suggestions and mocked execution helpers."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any, Literal, cast

from pydantic import BaseModel, Field

ActionType = Literal["send_email", "create_support_ticket", "schedule_maintenance"]
ActionPriority = Literal["normal", "high", "urgent"]

MAX_ACTION_PAYLOAD_BYTES = 50 * 1024

_REFERENCE_PREFIX: dict[str, str] = {
    "send_email": "MSG",
    "create_support_ticket": "TCK",
    "schedule_maintenance": "MNT",
}
SUPPORTED_ACTION_TYPES = frozenset(_REFERENCE_PREFIX)


class PostRunActionSubmission(BaseModel):
    """A persisted record of a mocked post-run action."""

    submission_id: str
    action_type: ActionType
    reference_id: str
    message: str
    submitted_at: str
    status: Literal["success"] = "success"
    payload: dict[str, Any] = Field(default_factory=dict)
    submitted_by: str | None = None


class PostRunAction(BaseModel):
    """Suggested action shown to the user after a run completes."""

    type: ActionType
    label: str
    description: str
    priority: ActionPriority
    enabled: bool = True
    draft: dict[str, Any]
    latest_submission: PostRunActionSubmission | None = None


class PostRunActionsResponse(BaseModel):
    """Available post-run actions for a completed run."""

    run_id: str
    status: Literal["ready"] = "ready"
    result_title: str
    actions: list[PostRunAction]


class ExecutePostRunActionRequest(BaseModel):
    """Request body for a mocked post-run action execution."""

    action_type: str
    payload: Any = Field(default_factory=dict)

    @property
    def normalized_action_type(self) -> ActionType:
        """Return the action type after caller validation."""
        return cast(ActionType, self.action_type)


class ExecutePostRunActionResponse(BaseModel):
    """Response returned after mocked post-run action execution."""

    success: bool
    run_id: str
    action_type: ActionType
    submission_id: str
    reference_id: str
    message: str
    submitted_at: str


class _RunInsights(BaseModel):
    title: str
    asset_id: str
    severity: str
    summary: str
    likely_cause: str
    recommendation: str


def build_post_run_actions_response(
    *,
    run_id: str,
    query: str,
    result: str,
    document: str,
    recipient_email: str,
    submissions: list[dict[str, Any]] | None = None,
) -> PostRunActionsResponse:
    """Build deterministic post-run action suggestions from run output."""

    insights = _extract_insights(run_id=run_id, query=query, result=result, document=document)
    latest_by_type = _latest_submissions_by_type(submissions or [])
    urgent_followup = insights.severity.lower() in {"critical", "high", "medium-high"}
    ticket_priority = "High" if urgent_followup else "Normal"
    maintenance_priority = "Urgent" if urgent_followup else "Normal"

    email_draft = {
        "recipient": recipient_email,
        "subject": f"Run result: {insights.title}",
        "body": result,
        "run_id": run_id,
    }
    ticket_draft = {
        "title": f"{insights.asset_id}: {insights.severity} finding from agent analysis",
        "priority": ticket_priority,
        "asset_id": insights.asset_id,
        "description": _build_ticket_description(query=query, run_id=run_id, insights=insights),
        "run_id": run_id,
    }
    maintenance_draft = {
        "asset_id": insights.asset_id,
        "priority": maintenance_priority,
        "requested_timing": "Immediate / next available maintenance window",
        "summary": insights.recommendation or insights.summary,
        "run_id": run_id,
    }

    return PostRunActionsResponse(
        run_id=run_id,
        result_title=insights.title,
        actions=[
            PostRunAction(
                type="schedule_maintenance",
                label="Schedule maintenance",
                description=f"Schedule immediate maintenance for {insights.asset_id}.",
                priority="urgent" if urgent_followup else "high",
                draft=maintenance_draft,
                latest_submission=latest_by_type.get("schedule_maintenance"),
            ),
            PostRunAction(
                type="create_support_ticket",
                label="Create support ticket",
                description=f"Create a support ticket draft for {insights.asset_id}.",
                priority="high" if urgent_followup else "normal",
                draft=ticket_draft,
                latest_submission=latest_by_type.get("create_support_ticket"),
            ),
            PostRunAction(
                type="send_email",
                label="Send email",
                description="Send the final result to your inbox.",
                priority="normal",
                draft=email_draft,
                latest_submission=latest_by_type.get("send_email"),
            ),
        ],
    )


def validate_action_payload(action_type: ActionType, payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize user-edited payload for a post-run action."""

    try:
        payload_size = len(json.dumps(payload, default=str).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Action payload must be JSON-serializable") from exc
    if payload_size > MAX_ACTION_PAYLOAD_BYTES:
        raise ValueError("Action payload exceeds the 50 KB limit")

    required_fields: dict[str, tuple[str, ...]] = {
        "send_email": ("subject", "body"),
        "create_support_ticket": ("title", "priority", "asset_id", "description"),
        "schedule_maintenance": ("asset_id", "priority", "requested_timing", "summary"),
    }
    missing = [
        field
        for field in required_fields[action_type]
        if not isinstance(payload.get(field), str) or not payload[field].strip()
    ]
    if missing:
        raise ValueError(f"Missing required action field(s): {', '.join(missing)}")

    return dict(payload)


def create_mock_action_submission(
    *,
    action_type: ActionType,
    payload: dict[str, Any],
    run_id: str,
    submitted_by: str | None,
    submitted_at: datetime | None = None,
) -> dict[str, Any]:
    """Return a mocked success submission for a validated post-run action."""

    now = submitted_at or datetime.now()
    suffix = uuid.uuid4().hex[:6].upper()
    reference_id = f"{_REFERENCE_PREFIX[action_type]}-{now:%Y%m%d}-{suffix}"
    submission_id = f"act_{uuid.uuid4().hex[:8]}"
    message = _build_success_message(action_type, reference_id, payload)

    return {
        "submission_id": submission_id,
        "action_type": action_type,
        "reference_id": reference_id,
        "status": "success",
        "message": message,
        "payload": payload,
        "submitted_at": now.isoformat(),
        "submitted_by": submitted_by,
    }


def _extract_insights(*, run_id: str, query: str, result: str, document: str) -> _RunInsights:
    analysis_text = "\n\n".join(part for part in (result, document, query) if part)
    title = _extract_markdown_title(result) or _extract_markdown_title(document) or f"Run {run_id}"
    asset_id = _extract_asset_id(analysis_text)
    severity = _extract_severity(analysis_text)
    summary = (
        _extract_section(result, ("Health status", "Executive summary"))
        or _extract_section(document, ("Health status", "Executive summary"))
        or _extract_first_paragraph(result)
        or _extract_first_paragraph(document)
        or "Review the completed agent analysis for details."
    )
    likely_cause = _extract_section(result, ("Likely cause",)) or _extract_section(document, ("Likely cause",))
    recommendation = (
        _extract_section(result, ("Recommended next maintenance action", "Recommended next step"))
        or _extract_section(document, ("Recommended next maintenance action", "Recommended next step"))
        or _extract_recommendation_sentence(analysis_text)
        or "Review the result and choose the appropriate operational follow-up."
    )

    return _RunInsights(
        title=title,
        asset_id=asset_id,
        severity=_display_severity(severity),
        summary=summary,
        likely_cause=likely_cause,
        recommendation=recommendation,
    )


def _extract_markdown_title(text: str) -> str:
    match = re.search(r"^\s*#\s+(.+?)\s*#*\s*$", text, flags=re.MULTILINE)
    return _clean_text(match.group(1)) if match else ""


def _extract_asset_id(text: str) -> str:
    match = re.search(r"\b[A-Z]{2,10}-[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})*\b", text)
    return match.group(0) if match else "Current asset"


def _extract_severity(text: str) -> str:
    lowered = text.lower()
    patterns = (
        ("medium-high", r"\bmedium[- ]high\b"),
        ("critical", r"\bcritical\b"),
        ("high", r"\bhigh\b"),
        ("medium", r"\bmedium\b"),
        ("low", r"\blow\b"),
    )
    for severity, pattern in patterns:
        if re.search(pattern, lowered):
            return severity
    return "normal"


def _display_severity(severity: str) -> str:
    if severity == "medium-high":
        return "Medium-high"
    return severity.capitalize()


def _extract_section(text: str, heading_names: tuple[str, ...]) -> str:
    wanted = {_normalize_heading(name) for name in heading_names}
    capturing = False
    captured: list[str] = []

    for line in text.splitlines():
        heading = re.match(r"^\s{0,3}#{2,6}\s+(.+?)\s*#*\s*$", line)
        if heading:
            if capturing:
                break
            capturing = _normalize_heading(heading.group(1)) in wanted
            continue
        if capturing:
            captured.append(line)

    return _clean_text("\n".join(captured))


def _extract_first_paragraph(text: str) -> str:
    for paragraph in re.split(r"\n\s*\n", text):
        candidate = paragraph.strip()
        if not candidate or candidate.startswith("#"):
            continue
        return _clean_text(candidate)
    return ""


def _extract_recommendation_sentence(text: str) -> str:
    normalized = _clean_text(text)
    for sentence in re.split(r"(?<=[.!?])\s+", normalized):
        if re.search(r"\b(inspect|schedule|replace|reduce|monitor)\b", sentence, flags=re.IGNORECASE):
            return sentence.strip()
    return ""


def _build_ticket_description(*, query: str, run_id: str, insights: _RunInsights) -> str:
    parts = [
        f"Run ID: {run_id}",
        f"Original query: {query or 'Not available'}",
        f"Summary: {insights.summary}",
    ]
    if insights.likely_cause:
        parts.append(f"Likely cause: {insights.likely_cause}")
    if insights.recommendation:
        parts.append(f"Recommended action: {insights.recommendation}")
    return "\n\n".join(parts)


def _latest_submissions_by_type(raw_submissions: list[dict[str, Any]]) -> dict[str, PostRunActionSubmission]:
    latest: dict[str, PostRunActionSubmission] = {}
    for raw_submission in raw_submissions:
        if not isinstance(raw_submission, dict):
            continue
        try:
            submission = PostRunActionSubmission(**raw_submission)
        except ValueError:
            continue
        latest[submission.action_type] = submission
    return latest


def _build_success_message(action_type: ActionType, reference_id: str, payload: dict[str, Any]) -> str:
    asset_id = str(payload.get("asset_id") or "the asset").strip() or "the asset"
    if action_type == "schedule_maintenance":
        return f"Maintenance {reference_id} scheduled for {asset_id}."
    if action_type == "create_support_ticket":
        return f"Support ticket {reference_id} created for {asset_id}."
    return f"Email {reference_id} queued for delivery to your inbox."


def _normalize_heading(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _clean_text(value: str) -> str:
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    value = re.sub(r"\*([^*]+)\*", r"\1", value)
    value = re.sub(r"^\s*[-*]\s+", "", value, flags=re.MULTILINE)
    value = re.sub(r"\s+", " ", value)
    return value.strip()
