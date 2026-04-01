"""MailTools — facilitator tools for sending email to the logged-in user."""

import logging

from agent_framework import FunctionTool
from pydantic import BaseModel, Field

from src.config import Config
from src.graph_mail_client import send_mail

logger = logging.getLogger(__name__)


class SendEmailInput(BaseModel):
    subject: str = Field(description="Email subject line — short summary of the request/response.")
    body: str = Field(description="Email body in HTML format with the full final response content.")


class MailTools:
    """Facilitator tools for sending email via Microsoft Graph.

    Sends from an admin mailbox (configured via MAIL_SENDER_ADDRESS)
    to the logged-in user using Managed Identity with Mail.Send permission.
    """

    def __init__(self, user_email: str, config: Config):
        self._user_email = user_email
        self._sender = config.mail_sender_address

    async def _send_email_to_user(self, subject: str, body: str) -> str:
        """Send an email to the logged-in user with the final response."""
        if not self._user_email:
            return "Error: no user email available — cannot send email."
        if not self._sender:
            return "Error: MAIL_SENDER_ADDRESS not configured — cannot send email."

        logger.info(
            "📧 MailTools: sending to=%s from=%s subject='%s'",
            self._user_email, self._sender, subject[:80],
        )
        return await send_mail(
            sender=self._sender,
            to=self._user_email,
            subject=subject,
            body_html=body,
        )

    def get_tools(self) -> list[FunctionTool]:
        """Return mail FunctionTool objects for the facilitator."""
        return [
            FunctionTool(
                name="send_email_to_user",
                description=(
                    f"Send an email to the logged-in user ({self._user_email}) "
                    f"with the final response. The email is sent from the admin mailbox. "
                    f"Use HTML formatting in the body."
                ),
                func=self._send_email_to_user,
                input_model=SendEmailInput,
            ),
        ]
