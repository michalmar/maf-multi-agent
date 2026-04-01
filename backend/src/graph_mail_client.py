"""Microsoft Graph mail client — sends email via Graph API using Managed Identity.

Uses DefaultAzureCredential (MI in ACA, Azure CLI locally) with the
Mail.Send application permission to send email from an admin mailbox.
No user token is needed — this is purely app-level auth.
"""

import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

import httpx
from azure.identity import DefaultAzureCredential

logger = logging.getLogger(__name__)

GRAPH_SCOPE = "https://graph.microsoft.com/.default"
GRAPH_SEND_MAIL_URL = "https://graph.microsoft.com/v1.0/users/{sender}/sendMail"
TOKEN_REFRESH_BUFFER_SECONDS = 300


@dataclass
class _CachedToken:
    token: str
    expires_at: float


_token_cache: dict[str, _CachedToken] = {}
_token_lock = threading.Lock()
_credential: Optional[DefaultAzureCredential] = None


def _get_graph_token() -> str:
    """Acquire a Microsoft Graph token via DefaultAzureCredential. Thread-safe."""
    global _credential
    cache_key = f"graph:{GRAPH_SCOPE}"
    with _token_lock:
        cached = _token_cache.get(cache_key)
        if cached and cached.expires_at > time.time() + TOKEN_REFRESH_BUFFER_SECONDS:
            return cached.token

        if _credential is None:
            managed_identity_client_id = os.environ.get("AZURE_CLIENT_ID", "")
            if managed_identity_client_id:
                _credential = DefaultAzureCredential(
                    managed_identity_client_id=managed_identity_client_id,
                )
                logger.info("🔑 Graph mail: using MI client_id=%s...", managed_identity_client_id[:8])
            else:
                _credential = DefaultAzureCredential()
                logger.info("🔑 Graph mail: using DefaultAzureCredential (auto-resolve)")

        token_response = _credential.get_token(GRAPH_SCOPE)
        _token_cache[cache_key] = _CachedToken(
            token=token_response.token,
            expires_at=token_response.expires_on,
        )
        logger.info(
            "🔑 Graph token acquired (expires in %.0fs)",
            token_response.expires_on - time.time(),
        )
        return token_response.token


async def send_mail(
    sender: str,
    to: str,
    subject: str,
    body_html: str,
) -> str:
    """Send an email via Microsoft Graph API.

    Args:
        sender: The mailbox to send from (must be authorized for the MI).
        to: Recipient email address.
        subject: Email subject line.
        body_html: HTML body content.

    Returns:
        Success message or error description.
    """
    token = await asyncio.to_thread(_get_graph_token)

    url = GRAPH_SEND_MAIL_URL.format(sender=sender)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "message": {
            "subject": subject,
            "body": {
                "contentType": "HTML",
                "content": body_html,
            },
            "toRecipients": [
                {"emailAddress": {"address": to}},
            ],
        },
        "saveToSentItems": "true",
    }

    logger.info("📧 Sending email: from=%s to=%s subject='%s'", sender, to, subject[:80])

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, headers=headers, json=payload)

    if resp.status_code == 202:
        logger.info("✅ Email sent successfully to %s", to)
        return f"Email sent successfully to {to}"
    else:
        error_text = resp.text[:500]
        logger.error("❌ Graph sendMail failed: %d %s", resp.status_code, error_text)
        return f"Failed to send email (HTTP {resp.status_code}): {error_text}"
