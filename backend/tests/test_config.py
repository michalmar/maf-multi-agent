"""Tests for configuration loading."""

import pytest
from unittest.mock import patch
import os


def test_config_loads_defaults():
    """Config should load with sensible defaults when env vars are missing."""
    with patch.dict(os.environ, {}, clear=True):
        from src.config import Config

        config = Config()
        assert config.azure_openai_chat_deployment_name == "gpt-4o"
        assert config.azure_openai_summary_deployment_name == "gpt-4.1-nano"
        assert config.allowed_origins == "*"
        assert config.project_endpoint == ""
        assert config.mail_sender_address == ""
        assert config.mail_enabled is False


def test_config_reads_env_vars():
    """Config should read from environment variables."""
    env = {
        "PROJECT_ENDPOINT": "https://test.endpoint.com",
        "AZURE_OPENAI_ENDPOINT": "https://test.openai.com",
        "ALLOWED_ORIGINS": "https://myapp.com,https://other.com",
        "MAIL_SENDER_ADDRESS": "admin@test.com",
    }
    with patch.dict(os.environ, env, clear=True):
        from src.config import Config

        config = Config()
        assert config.project_endpoint == "https://test.endpoint.com"
        assert config.azure_openai_endpoint == "https://test.openai.com"
        assert config.allowed_origins == "https://myapp.com,https://other.com"
        assert config.mail_sender_address == "admin@test.com"
        assert config.mail_enabled is True


def test_config_mail_disabled_when_empty():
    """mail_enabled is False when mail_sender_address is empty."""
    with patch.dict(os.environ, {"MAIL_SENDER_ADDRESS": ""}, clear=True):
        from src.config import Config

        config = Config()
        assert config.mail_enabled is False
