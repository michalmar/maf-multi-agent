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


def load_config() -> Config:
    """Load configuration from environment variables."""
    load_dotenv()
    return Config(
        project_endpoint=os.environ.get("PROJECT_ENDPOINT", ""),
        azure_openai_endpoint=os.environ.get("AZURE_OPENAI_ENDPOINT", ""),
        azure_openai_chat_deployment_name=os.environ.get(
            "AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o"
        ),
    )
