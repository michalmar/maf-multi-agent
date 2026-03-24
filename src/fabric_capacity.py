"""Fabric capacity status check via Azure Resource Manager API.

Checks whether the underlying Microsoft Fabric capacity is Active,
Paused, or in another state.  Optionally resumes a paused capacity.

Requires FABRIC_CAPACITY_RESOURCE_ID env var set to the full ARM
resource ID, e.g.:
  /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Fabric/capacities/<name>

Uses DefaultAzureCredential (same managed identity as the rest of the app).
"""

import logging
import os
import re

import httpx
from azure.identity.aio import DefaultAzureCredential

logger = logging.getLogger(__name__)

ARM_API_VERSION = "2023-11-01"
ARM_SCOPE = "https://management.azure.com/.default"


def _get_resource_id() -> str | None:
    """Return the Fabric capacity ARM resource ID from the environment."""
    return os.environ.get("FABRIC_CAPACITY_RESOURCE_ID", "").strip() or None


def _parse_resource_id(resource_id: str) -> dict:
    """Extract subscription, resource group, and capacity name from ARM ID."""
    pattern = (
        r"/subscriptions/(?P<subscription>[^/]+)"
        r"/resourceGroups/(?P<resource_group>[^/]+)"
        r"/providers/Microsoft\.Fabric/capacities/(?P<capacity_name>[^/]+)"
    )
    match = re.search(pattern, resource_id, re.IGNORECASE)
    if not match:
        raise ValueError(f"Cannot parse Fabric capacity resource ID: {resource_id}")
    return match.groupdict()


async def get_fabric_capacity_status() -> dict:
    """Query the ARM API for the current Fabric capacity state.

    Returns a dict with: enabled, state, sku, name, resource_group.
    If FABRIC_CAPACITY_RESOURCE_ID is not set, returns {enabled: false}.
    """
    resource_id = _get_resource_id()
    if not resource_id:
        return {"enabled": False}

    try:
        parts = _parse_resource_id(resource_id)
    except ValueError as e:
        logger.error("❌ %s", e)
        return {"enabled": True, "state": "Unknown", "error": str(e)}

    url = (
        f"https://management.azure.com{resource_id}"
        f"?api-version={ARM_API_VERSION}"
    )

    async with DefaultAzureCredential() as credential:
        token = await credential.get_token(ARM_SCOPE)

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        logger.error("Fabric capacity GET failed: %d %s", e.response.status_code, e.response.text[:300])
        return {
            "enabled": True,
            "state": "Unknown",
            "error": f"ARM API returned {e.response.status_code}",
        }
    except Exception as e:
        logger.error("Fabric capacity check failed: %s", e)
        return {"enabled": True, "state": "Unknown", "error": str(e)}

    props = data.get("properties", {})
    sku = data.get("sku", {})

    state = props.get("state", "Unknown")
    logger.info("🏭 Fabric capacity: %s — state=%s sku=%s", parts["capacity_name"], state, sku.get("name", "?"))

    return {
        "enabled": True,
        "state": state,
        "sku": sku.get("name", ""),
        "name": parts["capacity_name"],
        "resource_group": parts["resource_group"],
    }


async def resume_fabric_capacity() -> dict:
    """Resume a paused/suspended Fabric capacity via the ARM API.

    Returns the new state or an error.
    """
    resource_id = _get_resource_id()
    if not resource_id:
        return {"enabled": False, "error": "FABRIC_CAPACITY_RESOURCE_ID not configured"}

    url = (
        f"https://management.azure.com{resource_id}/resume"
        f"?api-version={ARM_API_VERSION}"
    )

    async with DefaultAzureCredential() as credential:
        token = await credential.get_token(ARM_SCOPE)

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers)
            if resp.status_code in (200, 202):
                logger.info("▶️  Fabric capacity resume initiated")
                return {"success": True, "message": "Resume initiated"}
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.error("Fabric capacity resume failed: %d %s", e.response.status_code, e.response.text[:300])
        return {"success": False, "error": f"ARM API returned {e.response.status_code}"}
    except Exception as e:
        logger.error("Fabric capacity resume failed: %s", e)
        return {"success": False, "error": str(e)}

    return {"success": True}
