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

# Global stores:
# - file_key -> (bytes, content_type)
# - sandbox_path -> latest file_key for URL rewriting during the active run
_store: dict[str, tuple[bytes, str]] = {}
_path_to_file_key: dict[str, str] = {}
_lock = threading.Lock()

# Image file extensions that should render inline (![alt](url) syntax)
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"}


def _safe_basename(sandbox_path: str) -> str:
    """Return a filesystem-safe basename for a sandbox path."""
    basename = os.path.basename(sandbox_path.replace("sandbox:", "")) or "artifact"
    basename = re.sub(r"[^a-zA-Z0-9._-]+", "_", basename).strip("._")
    return (basename or "artifact")[:180]


def _disk_key(sandbox_path: str, data: bytes) -> str:
    """Create a stable, collision-resistant filename for stored file bytes."""
    digest = hashlib.sha256(sandbox_path.encode() + b"\0" + data).hexdigest()[:16]
    return f"{digest}-{_safe_basename(sandbox_path)}"


def _legacy_disk_key(sandbox_path: str) -> str:
    """Return the pre-unique-key filename for backward-compatible disk lookup."""
    basename = os.path.basename(sandbox_path.replace("sandbox:", ""))
    if basename and len(basename) < 200:
        return basename
    return hashlib.sha256(sandbox_path.encode()).hexdigest()[:16]


def _current_file_key(sandbox_path: str) -> str:
    """Return the current stored file key for a sandbox path, if known."""
    with _lock:
        file_key = _path_to_file_key.get(sandbox_path)
    if file_key:
        return file_key
    return f"{hashlib.sha256(sandbox_path.encode()).hexdigest()[:16]}-{_safe_basename(sandbox_path)}"


def store_file(sandbox_path: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Store downloaded file bytes keyed by the original sandbox path."""
    disk_name = _disk_key(sandbox_path, data)
    with _lock:
        _store[disk_name] = (data, content_type)
        _path_to_file_key[sandbox_path] = disk_name

    # Persist to disk
    try:
        _PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        disk_path = _PERSIST_DIR / disk_name
        disk_path.write_bytes(data)
        logger.info("📦 Stored sandbox file: %s → %s (%d bytes, %s)", sandbox_path, disk_path, len(data), content_type)
    except Exception as e:
        logger.warning("⚠️  Disk persist failed for %s: %s", sandbox_path, e)
        logger.info("📦 Stored sandbox file (memory only): %s (%d bytes, %s)", sandbox_path, len(data), content_type)


def get_file(file_key_or_sandbox_path: str) -> Optional[tuple[bytes, str]]:
    """Retrieve stored file bytes and content type.

    Falls back to disk search if not in memory (enables replay after restart).
    Searches ``output/sandbox_files/`` and all ``output/*/files/`` directories.
    """
    sandbox_path = file_key_or_sandbox_path
    with _lock:
        file_key = _path_to_file_key.get(sandbox_path, file_key_or_sandbox_path)
        entry = _store.get(file_key)
    if entry:
        return entry

    # Disk fallback: search persistence dirs for the file
    candidates = [file_key]
    if file_key_or_sandbox_path.startswith("sandbox:") or file_key_or_sandbox_path.startswith("/"):
        candidates.append(_legacy_disk_key(sandbox_path))
    output_root = _PERSIST_DIR.parent  # output/

    search_dirs = [_PERSIST_DIR]  # output/sandbox_files/
    if output_root.is_dir():
        search_dirs.extend(output_root.glob("*/files"))       # legacy: output/{run_id}/files/
        search_dirs.extend(output_root.glob("*/*/files"))     # per-user: output/{user}/{run_id}/files/

    for disk_name in dict.fromkeys(candidates):
        for search_dir in search_dirs:
            disk_path = search_dir / disk_name
            if disk_path.is_file():
                try:
                    data = disk_path.read_bytes()
                    ct = guess_content_type(str(disk_path))
                    with _lock:
                        _store[disk_name] = (data, ct)
                        if sandbox_path.startswith("sandbox:"):
                            _path_to_file_key[sandbox_path] = disk_name
                    logger.info("📦 Loaded from disk cache: %s → %s", sandbox_path, disk_path)
                    return (data, ct)
                except Exception:
                    continue

    return None


def has_file(sandbox_path: str) -> bool:
    with _lock:
        file_key = _path_to_file_key.get(sandbox_path, sandbox_path)
        return file_key in _store


def get_all_files() -> dict[str, tuple[bytes, str]]:
    """Return a file-keyed snapshot of all stored files (thread-safe copy)."""
    with _lock:
        return dict(_store)


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
        encoded = urllib.parse.quote(_current_file_key(sandbox_url), safe="")
        api_url = f"{base_url}/{encoded}"

        if _is_image_file(sandbox_url):
            return f"![{link_text}]({api_url})"
        return f"[{link_text}]({api_url})"

    # First pass: rewrite markdown links [text](sandbox:...)
    result = _SANDBOX_LINK_RE.sub(_replace_link, text)

    # Second pass: rewrite any remaining standalone sandbox: URLs
    # (not already inside a markdown link — these would be bare URLs)
    def _replace_bare(match: re.Match) -> str:
        sandbox_url = match.group(0)
        encoded = urllib.parse.quote(_current_file_key(sandbox_url), safe="")
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
        filename = _current_file_key(sandbox_url)
        rel_path = f"{files_subdir}/{filename}"

        if _is_image_file(sandbox_url):
            return f"![{link_text}]({rel_path})"
        return f"[{link_text}]({rel_path})"

    result = _SANDBOX_LINK_RE.sub(_replace_link, text)

    def _replace_bare(match: re.Match) -> str:
        sandbox_url = match.group(0)
        filename = _current_file_key(sandbox_url)
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
        for filename, (data, _ct) in _store.items():
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


def _reset_for_tests() -> None:
    """Clear in-memory file mappings for tests."""
    with _lock:
        _store.clear()
        _path_to_file_key.clear()
