"""Reject credential-bearing Terraform artifacts in the Git index, without printing contents."""

import argparse
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile


def artifact_reason(name: str, content: bytes) -> str | None:
    path = PurePosixPath(name.lower())
    basename = path.name
    if ".terraform" in path.parts:
        return "Terraform working directory"
    if (
        ".tfstate" in basename
        or basename == "tfplan"
        or basename.startswith("tfplan.")
        or ".tfplan" in basename
    ):
        return "Terraform state or saved plan"
    if basename.endswith((".tfvars", ".tfvars.json")):
        return "Terraform variable values (use a .example template)"

    # Saved plans are ZIP archives even when renamed without a plan extension.
    stream = io.BytesIO(content)
    if zipfile.is_zipfile(stream):
        with zipfile.ZipFile(stream) as archive:
            members = {PurePosixPath(item).name for item in archive.namelist()}
        if members.intersection({"tfplan", "tfstate", "tfstate-prev"}):
            return "Terraform plan archive (including embedded state)"

    try:
        data = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    if "terraform_version" in data and (
        {"version", "resources"} <= data.keys()
        or {"version", "modules"} <= data.keys()
        or "format_version" in data
    ):
        return "Terraform state or plan JSON"
    return None


def check_index(repo: Path) -> list[tuple[str, str]]:
    entries = subprocess.run(
        ["git", "ls-files", "--stage", "-z"],
        cwd=repo, check=True, stdout=subprocess.PIPE,
    ).stdout
    findings = []
    for entry in entries.split(b"\0"):
        if not entry:
            continue
        metadata, raw_path = entry.split(b"\t", 1)
        mode, object_id, stage = metadata.split()
        name = raw_path.decode("utf-8", errors="surrogateescape")
        if stage != b"0" or mode == b"160000":
            findings.append((name, "unmerged entry or submodule cannot be scanned"))
            continue
        content = subprocess.run(
            ["git", "cat-file", "blob", object_id.decode("ascii")],
            cwd=repo, check=True, stdout=subprocess.PIPE,
        ).stdout
        reason = artifact_reason(name, content)
        if reason:
            findings.append((name, reason))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    findings = check_index(args.repo)
    print(json.dumps({"scope": "git-index", "findings": findings}, ensure_ascii=True))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
