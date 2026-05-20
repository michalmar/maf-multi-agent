"""Unit tests for Fabric capacity status helpers."""

from azure.core.exceptions import ClientAuthenticationError
import pytest

from src.fabric_capacity import get_fabric_capacity_status, resume_fabric_capacity


RESOURCE_ID = (
    "/subscriptions/sub-1/resourceGroups/rg-1/"
    "providers/Microsoft.Fabric/capacities/capacity-1"
)


@pytest.mark.asyncio
async def test_fabric_status_returns_unknown_when_local_auth_unavailable(monkeypatch):
    """Capacity status should not 500 when local DefaultAzureCredential cannot authenticate."""
    monkeypatch.setenv("FABRIC_CAPACITY_RESOURCE_ID", RESOURCE_ID)

    async def raise_auth_error():
        raise ClientAuthenticationError(message="DefaultAzureCredential failed")

    monkeypatch.setattr("src.fabric_capacity._get_arm_access_token", raise_auth_error)

    status = await get_fabric_capacity_status()

    assert status == {
        "enabled": True,
        "state": "Unknown",
        "error": "Azure authentication unavailable for Fabric capacity status",
    }


@pytest.mark.asyncio
async def test_fabric_resume_returns_failure_when_local_auth_unavailable(monkeypatch):
    """Resume should surface auth failure as a response payload instead of an ASGI exception."""
    monkeypatch.setenv("FABRIC_CAPACITY_RESOURCE_ID", RESOURCE_ID)

    async def raise_auth_error():
        raise ClientAuthenticationError(message="DefaultAzureCredential failed")

    monkeypatch.setattr("src.fabric_capacity._get_arm_access_token", raise_auth_error)

    result = await resume_fabric_capacity()

    assert result == {
        "success": False,
        "error": "Azure authentication unavailable for Fabric capacity resume",
    }
