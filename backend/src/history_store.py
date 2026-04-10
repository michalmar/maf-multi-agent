"""Persistent history store for session snapshots and sandbox files.

Two implementations:
- BlobHistoryStore: Azure Blob Storage (enterprise — survives ACA redeploys)
- LocalHistoryStore: Local filesystem (development fallback)

The active implementation is selected by the HISTORY_STORAGE_ACCOUNT_URL env var.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
from typing import Protocol

logger = logging.getLogger(__name__)

# Only allow safe characters in run IDs and user dirs
_SAFE_RE = re.compile(r"^[a-zA-Z0-9@.\-_]+$")
_LOCAL_USER_DIR = "__local__"


class HistoryStore(Protocol):
    """Abstract interface for session history persistence."""

    async def save_session(self, user_dir: str, run_id: str, snapshot: dict) -> None: ...
    async def save_file(self, user_dir: str, run_id: str, filename: str, data: bytes) -> None: ...
    async def list_sessions(self, user_dir: str | None, include_user: bool = False) -> list[dict]: ...
    async def get_session(self, user_dir: str, run_id: str) -> dict | None: ...
    async def delete_session(self, user_dir: str, run_id: str) -> bool: ...
    async def get_file(self, user_dir: str, run_id: str, filename: str) -> bytes | None: ...
    async def list_all_sessions(self, include_user: bool = True) -> list[dict]: ...


# ── Blob Storage Implementation ───────────────────────────────


class BlobHistoryStore:
    """Azure Blob Storage backed history store."""

    CONTAINER_NAME = "history"

    def __init__(self, account_url: str):
        from azure.identity.aio import DefaultAzureCredential
        from azure.storage.blob.aio import BlobServiceClient

        mi_client_id = os.environ.get("AZURE_CLIENT_ID")
        self._credential = DefaultAzureCredential(
            managed_identity_client_id=mi_client_id,
        )
        self._client = BlobServiceClient(account_url, credential=self._credential)
        self._container_name = self.CONTAINER_NAME
        logger.info("📦 BlobHistoryStore initialized: %s/%s", account_url, self._container_name)

    def _blob_path(self, user_dir: str, run_id: str, filename: str = "session.json") -> str:
        return f"{user_dir}/{run_id}/{filename}"

    async def save_session(self, user_dir: str, run_id: str, snapshot: dict) -> None:
        try:
            blob_path = self._blob_path(user_dir, run_id)
            container = self._client.get_container_client(self._container_name)
            data = json.dumps(snapshot, default=str, indent=2).encode()
            await container.upload_blob(blob_path, data, overwrite=True)
            logger.info("📸 Session snapshot saved to blob: %s", blob_path)
        except Exception as e:
            logger.warning("⚠️  Blob save failed for %s/%s: %s", user_dir, run_id, e)
            raise

    async def save_file(self, user_dir: str, run_id: str, filename: str, data: bytes) -> None:
        try:
            blob_path = self._blob_path(user_dir, run_id, f"files/{filename}")
            container = self._client.get_container_client(self._container_name)
            await container.upload_blob(blob_path, data, overwrite=True)
            logger.info("📦 File saved to blob: %s (%d bytes)", blob_path, len(data))
        except Exception as e:
            logger.warning("⚠️  Blob file save failed for %s: %s", filename, e)
            raise

    async def list_sessions(self, user_dir: str | None, include_user: bool = False) -> list[dict]:
        try:
            container = self._client.get_container_client(self._container_name)
            prefix = f"{user_dir}/" if user_dir else ""
            items: list[dict] = []
            seen_runs: set[str] = set()

            async for blob in container.list_blobs(name_starts_with=prefix):
                # Match pattern: {user_dir}/{run_id}/session.json
                if not blob.name.endswith("/session.json"):
                    continue
                parts = blob.name.rsplit("/", 2)
                if len(parts) < 3:
                    continue
                run_id = parts[-2]
                if run_id in seen_runs:
                    continue
                seen_runs.add(run_id)

                # Download and parse the snapshot for metadata
                blob_client = container.get_blob_client(blob.name)
                download = await blob_client.download_blob()
                content = await download.readall()
                try:
                    snap = json.loads(content)
                except (json.JSONDecodeError, ValueError):
                    continue

                item: dict = {
                    "run_id": snap.get("run_id", run_id),
                    "query": snap.get("query", "")[:200],
                    "timestamp": snap.get("timestamp", ""),
                    "status": snap.get("status", "unknown"),
                    "event_count": len(snap.get("events", [])),
                    "has_result": bool(snap.get("result")),
                }
                if include_user:
                    item["user_email"] = snap.get("user_email")
                items.append(item)

            items.sort(key=lambda x: x["run_id"], reverse=True)
            return items
        except Exception as e:
            logger.warning("⚠️  Blob list failed for %s: %s", user_dir, e)
            return []

    async def list_all_sessions(self, include_user: bool = True) -> list[dict]:
        """List sessions across all users (super-user access)."""
        return await self.list_sessions(user_dir=None, include_user=include_user)

    async def get_session(self, user_dir: str, run_id: str) -> dict | None:
        try:
            blob_path = self._blob_path(user_dir, run_id)
            container = self._client.get_container_client(self._container_name)
            blob_client = container.get_blob_client(blob_path)
            download = await blob_client.download_blob()
            content = await download.readall()
            return json.loads(content)
        except Exception as e:
            logger.debug("Blob get_session failed for %s/%s: %s", user_dir, run_id, e)
            return None

    async def delete_session(self, user_dir: str, run_id: str) -> bool:
        try:
            container = self._client.get_container_client(self._container_name)
            prefix = f"{user_dir}/{run_id}/"
            deleted = 0
            async for blob in container.list_blobs(name_starts_with=prefix):
                await container.delete_blob(blob.name)
                deleted += 1
            logger.info("🗑️  Deleted %d blob(s) for %s/%s", deleted, user_dir, run_id)
            return deleted > 0
        except Exception as e:
            logger.warning("⚠️  Blob delete failed for %s/%s: %s", user_dir, run_id, e)
            return False

    async def get_file(self, user_dir: str, run_id: str, filename: str) -> bytes | None:
        try:
            blob_path = self._blob_path(user_dir, run_id, f"files/{filename}")
            container = self._client.get_container_client(self._container_name)
            blob_client = container.get_blob_client(blob_path)
            download = await blob_client.download_blob()
            return await download.readall()
        except Exception:
            return None

    async def find_session_any_user(self, run_id: str) -> tuple[str, dict] | None:
        """Search all user prefixes for a run_id (super-user access)."""
        try:
            container = self._client.get_container_client(self._container_name)
            async for blob in container.list_blobs():
                if blob.name.endswith(f"/{run_id}/session.json"):
                    blob_client = container.get_blob_client(blob.name)
                    download = await blob_client.download_blob()
                    content = await download.readall()
                    snap = json.loads(content)
                    # Extract user_dir from blob path
                    user_dir = blob.name.split(f"/{run_id}/")[0]
                    return user_dir, snap
        except Exception as e:
            logger.warning("⚠️  Blob find_session_any_user failed for %s: %s", run_id, e)
        return None


# ── Local Filesystem Implementation ───────────────────────────


class LocalHistoryStore:
    """Local filesystem backed history store (development fallback)."""

    def __init__(self, output_dir: str):
        self._output_dir = output_dir
        logger.info("📁 LocalHistoryStore initialized: %s", output_dir)

    def _run_dir(self, user_dir: str, run_id: str) -> str:
        if user_dir and user_dir != _LOCAL_USER_DIR:
            return os.path.join(self._output_dir, user_dir, run_id)
        return os.path.join(self._output_dir, run_id)

    async def save_session(self, user_dir: str, run_id: str, snapshot: dict) -> None:
        run_dir = self._run_dir(user_dir, run_id)
        os.makedirs(run_dir, exist_ok=True)
        path = os.path.join(run_dir, "session.json")
        with open(path, "w") as f:
            json.dump(snapshot, f, default=str, indent=2)
        logger.info("📸 Session snapshot saved: %s", path)

    async def save_file(self, user_dir: str, run_id: str, filename: str, data: bytes) -> None:
        run_dir = self._run_dir(user_dir, run_id)
        files_dir = os.path.join(run_dir, "files")
        os.makedirs(files_dir, exist_ok=True)
        with open(os.path.join(files_dir, filename), "wb") as f:
            f.write(data)

    async def list_sessions(self, user_dir: str | None, include_user: bool = False) -> list[dict]:
        if user_dir and user_dir != _LOCAL_USER_DIR:
            scan_dir = os.path.join(self._output_dir, user_dir)
        else:
            scan_dir = self._output_dir
        return _list_sessions_on_disk(scan_dir, include_user)

    async def list_all_sessions(self, include_user: bool = True) -> list[dict]:
        """List sessions across all user directories (super-user access)."""
        items: list[dict] = []
        if not os.path.isdir(self._output_dir):
            return items
        for user_entry in os.listdir(self._output_dir):
            user_path = os.path.join(self._output_dir, user_entry)
            if not os.path.isdir(user_path) or user_entry == "sandbox_files":
                continue
            items.extend(_list_sessions_on_disk(user_path, include_user=True))
        items.sort(key=lambda x: x["run_id"], reverse=True)
        return items

    async def get_session(self, user_dir: str, run_id: str) -> dict | None:
        run_dir = self._run_dir(user_dir, run_id)
        session_path = os.path.join(run_dir, "session.json")
        if not os.path.isfile(session_path):
            return None
        with open(session_path) as f:
            return json.load(f)

    async def delete_session(self, user_dir: str, run_id: str) -> bool:
        run_dir = self._run_dir(user_dir, run_id)
        if not os.path.isdir(run_dir):
            return False
        shutil.rmtree(run_dir)
        return True

    async def get_file(self, user_dir: str, run_id: str, filename: str) -> bytes | None:
        run_dir = self._run_dir(user_dir, run_id)
        file_path = os.path.join(run_dir, "files", filename)
        if not os.path.isfile(file_path):
            return None
        with open(file_path, "rb") as f:
            return f.read()

    async def find_session_any_user(self, run_id: str) -> tuple[str, dict] | None:
        """Search all user directories for a run_id (super-user access)."""
        if not _SAFE_RE.match(run_id) or not os.path.isdir(self._output_dir):
            return None
        for user_entry in os.listdir(self._output_dir):
            user_path = os.path.join(self._output_dir, user_entry)
            if not os.path.isdir(user_path):
                continue
            candidate = os.path.join(user_path, run_id, "session.json")
            if os.path.isfile(candidate):
                with open(candidate) as f:
                    return user_entry, json.load(f)
        return None


# ── Disk helpers (used by LocalHistoryStore) ──────────────────


def _list_sessions_on_disk(scan_dir: str, include_user: bool = False) -> list[dict]:
    """List session snapshots in a directory, newest first."""
    items: list[dict] = []
    if not os.path.isdir(scan_dir):
        return items
    for entry in sorted(os.listdir(scan_dir), reverse=True):
        if not _SAFE_RE.match(entry):
            continue
        session_path = os.path.join(scan_dir, entry, "session.json")
        if not os.path.isfile(session_path):
            continue
        try:
            with open(session_path) as f:
                snap = json.load(f)
            item: dict = {
                "run_id": snap.get("run_id", entry),
                "query": snap.get("query", "")[:200],
                "timestamp": snap.get("timestamp", ""),
                "status": snap.get("status", "unknown"),
                "event_count": len(snap.get("events", [])),
                "has_result": bool(snap.get("result")),
            }
            if include_user:
                item["user_email"] = snap.get("user_email")
            items.append(item)
        except Exception:
            continue
    return items


# ── Factory ───────────────────────────────────────────────────

_instance: HistoryStore | None = None


def get_history_store() -> HistoryStore:
    """Return a singleton HistoryStore instance.

    Uses BlobHistoryStore when HISTORY_STORAGE_ACCOUNT_URL is configured,
    otherwise falls back to LocalHistoryStore.
    """
    global _instance
    if _instance is not None:
        return _instance

    from src.config import get_config
    config = get_config()

    if config.history_blob_enabled:
        _instance = BlobHistoryStore(config.history_storage_account_url)
    else:
        output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")
        _instance = LocalHistoryStore(output_dir)

    return _instance
