"""Tests for sandbox file storage and URL rewriting."""

import re

from src import file_store


def test_same_basename_files_get_unique_serving_keys(tmp_path, monkeypatch):
    """Files with the same basename should not overwrite each other."""
    monkeypatch.setattr(file_store, "_PERSIST_DIR", tmp_path)
    file_store._reset_for_tests()

    file_store.store_file("sandbox:/mnt/data/agent-a/plot.png", b"agent-a", "image/png")
    file_store.store_file("sandbox:/mnt/data/agent-b/plot.png", b"agent-b", "image/png")

    rewritten = file_store.rewrite_sandbox_urls(
        "[a](sandbox:/mnt/data/agent-a/plot.png)\n"
        "[b](sandbox:/mnt/data/agent-b/plot.png)"
    )
    file_keys = re.findall(r"/api/files/([^)]+)", rewritten)

    assert len(file_keys) == 2
    assert len(set(file_keys)) == 2
    assert file_store.get_file(file_keys[0]) == (b"agent-a", "image/png")
    assert file_store.get_file(file_keys[1]) == (b"agent-b", "image/png")
    assert (tmp_path / file_keys[0]).read_bytes() == b"agent-a"
    assert (tmp_path / file_keys[1]).read_bytes() == b"agent-b"


def test_copy_run_files_uses_unique_file_keys(tmp_path, monkeypatch):
    """Run-local artifact copies should keep collision-safe names."""
    monkeypatch.setattr(file_store, "_PERSIST_DIR", tmp_path / "cache")
    file_store._reset_for_tests()

    file_store.store_file("sandbox:/mnt/data/one/result.csv", b"one", "text/csv")
    file_store.store_file("sandbox:/mnt/data/two/result.csv", b"two", "text/csv")

    run_dir = tmp_path / "run"
    assert file_store.copy_run_files(str(run_dir)) == 2

    copied = sorted((run_dir / "files").iterdir())
    assert len(copied) == 2
    assert copied[0].name != copied[1].name
    assert sorted(path.read_bytes() for path in copied) == [b"one", b"two"]
