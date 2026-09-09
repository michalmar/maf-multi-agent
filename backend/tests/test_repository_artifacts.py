import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import zipfile

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "scripts" / "check_repository_artifacts.py"
MODULE = runpy.run_path(str(CHECKER))
artifact_reason = MODULE["artifact_reason"]
check_index = MODULE["check_index"]


@pytest.mark.parametrize("name", [
    "tfplan", "deploy/tfplan.backup", "elsewhere/change.tfplan",
    "terraform.tfstate", "state.tfstate.backup", "config.auto.tfvars",
    "config.tfvars.json", "infra/.terraform/terraform.tfstate",
])
def test_sensitive_artifact_names_are_rejected(name):
    assert artifact_reason(name, b"synthetic") is not None


@pytest.mark.parametrize("name", [
    "main.tf", ".terraform.lock.hcl", "terraform.tfvars.example",
    "terraform.tfvars.json.example", "docs/terraform.md",
])
def test_source_and_example_files_are_allowed(name):
    assert artifact_reason(name, b"example only") is None


@pytest.mark.parametrize("member", ["tfplan", "tfstate", "tfstate-prev"])
def test_renamed_binary_saved_plan_is_rejected(member):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(member, "synthetic fixture, no credentials")
    assert artifact_reason("innocent.bin", stream.getvalue()) is not None


@pytest.mark.parametrize("data", [
    {"terraform_version": "1.5.0", "version": 4, "resources": []},
    {"terraform_version": "1.5.0", "version": 3, "modules": []},
    {"terraform_version": "1.5.0", "format_version": "1.2", "planned_values": {}},
])
def test_renamed_state_and_plan_json_are_rejected(data):
    assert artifact_reason("output.json", json.dumps(data).encode()) is not None


@pytest.mark.parametrize("content", [b"", b"\xff", b"[]", b'{"version": 4}', b"PK"])
def test_non_terraform_content_is_allowed(content):
    assert artifact_reason("source.txt", content) is None


def test_unrelated_zip_is_allowed():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("example.txt", "synthetic")
    assert artifact_reason("example.zip", stream.getvalue()) is None


def test_index_is_scanned_instead_of_clean_worktree_and_values_are_not_printed(tmp_path):
    subprocess.run(["git", "init", "--quiet", str(tmp_path)], check=True)
    fixture_value = "synthetic-private-value-must-not-be-printed"
    file = tmp_path / "renamed.json"
    file.write_text(json.dumps({
        "terraform_version": "1.5.0", "version": 4, "resources": [],
        "outputs": {"fixture": {"value": fixture_value}},
    }))
    subprocess.run(["git", "add", "renamed.json"], cwd=tmp_path, check=True)
    file.write_text("safe worktree content")

    findings = check_index(tmp_path)
    assert findings == [("renamed.json", "Terraform state or plan JSON")]
    assert fixture_value not in repr(findings)
    result = subprocess.run(
        [sys.executable, str(CHECKER), "--repo", str(tmp_path)],
        check=False, capture_output=True, text=True,
    )
    assert result.returncode == 1
    assert json.loads(result.stdout)["findings"] == [["renamed.json", "Terraform state or plan JSON"]]
    assert fixture_value not in result.stdout + result.stderr


def test_cli_succeeds_for_clean_index(tmp_path):
    subprocess.run(["git", "init", "--quiet", str(tmp_path)], check=True)
    (tmp_path / "main.tf").write_text("# synthetic source\n")
    subprocess.run(["git", "add", "main.tf"], cwd=tmp_path, check=True)
    result = subprocess.run(
        [sys.executable, str(CHECKER), "--repo", str(tmp_path)],
        check=False, capture_output=True, text=True,
    )
    assert result.returncode == 0
    assert json.loads(result.stdout) == {"scope": "git-index", "findings": []}


def test_current_repository_index_has_no_terraform_artifacts():
    assert check_index(REPO_ROOT) == []
