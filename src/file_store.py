"""Thread-safe in-memory file store for Code Interpreter sandbox files.

When Azure Foundry agents use Code Interpreter, generated files (plots,
CSVs, etc.) live in a sandbox filesystem accessible only via ``file_id``.
This module stores downloaded file bytes and rewrites ``sandbox:`` URLs
in markdown text so the frontend can display them via a REST endpoint.

Files are also persisted to disk under ``output/sandbox_files/`` so they
survive server restarts.
"""

import hashlib
import logging
import mimetypes
import os
import re
import threading
import urllib.parse
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Disk persistence directory
_PERSIST_DIR = Path(__file__).resolve().parent.parent / "output" / "sandbox_files"

# Global store: sandbox_path → (bytes, content_type)
_store: dict[str, tuple[bytes, str]] = {}
_lock = threading.Lock()

# Image file extensions that should render inline (![alt](url) syntax)
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"}


def _disk_key(sandbox_path: str) -> str:
    """Create a safe filename from a sandbox path."""
    # Use the basename when possible, fall back to a hash
    basename = os.path.basename(sandbox_path.replace("sandbox:", ""))
    if basename and len(basename) < 200:
        return basename
    return hashlib.sha256(sandbox_path.encode()).hexdigest()[:16]


def store_file(sandbox_path: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Store downloaded file bytes keyed by the original sandbox path."""
    with _lock:
        _store[sandbox_path] = (data, content_type)

    # Persist to disk
    try:
        _PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        disk_name = _disk_key(sandbox_path)
        disk_path = _PERSIST_DIR / disk_name
        disk_path.write_bytes(data)
        logger.info("📦 Stored sandbox file: %s → %s (%d bytes, %s)", sandbox_path, disk_path, len(data), content_type)
    except Exception as e:
        logger.warning("⚠️  Disk persist failed for %s: %s", sandbox_path, e)
        logger.info("📦 Stored sandbox file (memory only): %s (%d bytes, %s)", sandbox_path, len(data), content_type)


def get_file(sandbox_path: str) -> Optional[tuple[bytes, str]]:
    """Retrieve stored file bytes and content type. Returns None if not found."""
    with _lock:
        return _store.get(sandbox_path)


def has_file(sandbox_path: str) -> bool:
    with _lock:
        return sandbox_path in _store


def guess_content_type(filename: str) -> str:
    """Guess MIME type from filename, defaulting to application/octet-stream."""
    mime, _ = mimetypes.guess_type(filename)
    return mime or "application/octet-stream"


def _is_image_file(path: str) -> bool:
    """Check if the file path has an image extension."""
    lower = path.lower()
    return any(lower.endswith(ext) for ext in _IMAGE_EXTENSIONS)


# Regex: matches sandbox:/mnt/data/... inside markdown links or standalone
# Captures the full sandbox URL (no whitespace or closing paren)
_SANDBOX_URL_RE = re.compile(r"sandbox:/mnt/data/[^\s\)\]]+")

# Regex: matches markdown link syntax [text](sandbox:/mnt/data/...)
_SANDBOX_LINK_RE = re.compile(
    r"\[([^\]]*)\]\((sandbox:/mnt/data/[^\)]+)\)"
)


def rewrite_sandbox_urls(text: str, base_url: str = "/api/files") -> str:
    """Replace ``sandbox:`` URLs with served file URLs.

    For image files (.png, .jpg, …), converts markdown link syntax
    ``[text](sandbox:…)`` to image syntax ``![text](/api/files/…)`` so
    ReactMarkdown renders them inline.

    For non-image files (.csv, .xlsx, …), keeps link syntax but rewrites
    the URL to ``/api/files/…`` so the browser can download them.
    """

    def _replace_link(match: re.Match) -> str:
        link_text = match.group(1)
        sandbox_url = match.group(2)
        sandbox_path = sandbox_url.replace("sandbox:", "")
        encoded = urllib.parse.quote(sandbox_path, safe="")
        api_url = f"{base_url}/{encoded}"

        if _is_image_file(sandbox_path):
            return f"![{link_text}]({api_url})"
        return f"[{link_text}]({api_url})"

    # First pass: rewrite markdown links [text](sandbox:...)
    result = _SANDBOX_LINK_RE.sub(_replace_link, text)

    # Second pass: rewrite any remaining standalone sandbox: URLs
    # (not already inside a markdown link — these would be bare URLs)
    def _replace_bare(match: re.Match) -> str:
        sandbox_url = match.group(0)
        sandbox_path = sandbox_url.replace("sandbox:", "")
        encoded = urllib.parse.quote(sandbox_path, safe="")
        return f"{base_url}/{encoded}"

    result = _SANDBOX_URL_RE.sub(_replace_bare, result)

    return result


def rewrite_sandbox_urls_for_disk(text: str, files_subdir: str = "./files") -> str:
    """Replace ``sandbox:`` URLs with relative file paths for self-contained disk output.

    Converts ``[text](sandbox:/mnt/data/plot.png)`` to
    ``![text](./files/plot.png)`` so the saved markdown renders correctly
    when opened alongside the ``files/`` subfolder.
    """

    def _replace_link(match: re.Match) -> str:
        link_text = match.group(1)
        sandbox_url = match.group(2)
        sandbox_path = sandbox_url.replace("sandbox:", "")
        filename = os.path.basename(sandbox_path)
        rel_path = f"{files_subdir}/{filename}"

        if _is_image_file(sandbox_path):
            return f"![{link_text}]({rel_path})"
        return f"[{link_text}]({rel_path})"

    result = _SANDBOX_LINK_RE.sub(_replace_link, text)

    def _replace_bare(match: re.Match) -> str:
        sandbox_url = match.group(0)
        sandbox_path = sandbox_url.replace("sandbox:", "")
        filename = os.path.basename(sandbox_path)
        return f"{files_subdir}/{filename}"

    result = _SANDBOX_URL_RE.sub(_replace_bare, result)

    return result


def copy_run_files(run_dir: str) -> int:
    """Copy all stored sandbox files into a run's ``files/`` subdirectory.

    Returns the number of files copied.
    """
    files_dir = os.path.join(run_dir, "files")
    os.makedirs(files_dir, exist_ok=True)
    count = 0
    with _lock:
        for sandbox_path, (data, _ct) in _store.items():
            filename = os.path.basename(sandbox_path.replace("sandbox:", ""))
            if not filename:
                continue
            dest = os.path.join(files_dir, filename)
            try:
                with open(dest, "wb") as f:
                    f.write(data)
                count += 1
            except Exception as e:
                logger.warning("⚠️  Failed to copy %s to run folder: %s", filename, e)
    if count:
        logger.info("📂 Copied %d sandbox file(s) to %s", count, files_dir)
    return count
