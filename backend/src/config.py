"""Configuration loaded from environment variables via Pydantic Settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings


class Config(BaseSettings):
    """Application configuration loaded from environment.

    All fields are populated automatically from environment variables
    (case-insensitive) or from a ``.env`` file in the working directory.
    """

    project_endpoint: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_chat_deployment_name: str = "gpt-4o"
    azure_openai_summary_deployment_name: str = "gpt-4.1-nano"
    mail_sender_address: str = ""  # Admin mailbox for Graph Mail.Send (empty = disabled)
    super_user_email: str = ""  # Super-user who can view all users' history (empty = disabled)
    allowed_origins: str = "*"  # Comma-separated CORS origins (default: allow all)
    history_storage_account_url: str = ""  # Blob Storage URL for persistent history (empty = local filesystem)

    model_config = {"env_file": ".env", "case_sensitive": False}

    @property
    def mail_enabled(self) -> bool:
        return bool(self.mail_sender_address)

    @property
    def history_blob_enabled(self) -> bool:
        return bool(self.history_storage_account_url)


@lru_cache(maxsize=1)
def get_config() -> Config:
    """Return a cached Config singleton."""
    return Config()
