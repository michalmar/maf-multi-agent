"""Configuration loader for environment variables."""

import os
from dataclasses import dataclass
from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    """Application configuration loaded from environment."""

    project_endpoint: str
    azure_openai_endpoint: str
    azure_openai_chat_deployment_name: str
    azure_openai_summary_deployment_name: str
    mail_sender_address: str  # Admin mailbox for Graph Mail.Send (empty = disabled)
    super_user_email: str  # Super-user who can view all users' history (empty = disabled)

    @property
    def mail_enabled(self) -> bool:
        return bool(self.mail_sender_address)


def load_config() -> Config:
    """Load configuration from environment variables."""
    load_dotenv()
    return Config(
        project_endpoint=os.environ.get("PROJECT_ENDPOINT", ""),
        azure_openai_endpoint=os.environ.get("AZURE_OPENAI_ENDPOINT", ""),
        azure_openai_chat_deployment_name=os.environ.get(
            "AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o"
        ),
        azure_openai_summary_deployment_name=os.environ.get(
            "AZURE_OPENAI_SUMMARY_DEPLOYMENT_NAME", "gpt-4.1-nano"
        ),
        mail_sender_address=os.environ.get("MAIL_SENDER_ADDRESS", ""),
        super_user_email=os.environ.get("SUPER_USER_EMAIL", ""),
    )
