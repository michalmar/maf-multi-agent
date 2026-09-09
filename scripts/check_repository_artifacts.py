"""Reject credential-bearing Terraform artifacts without printing their contents."""

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


def git_output(repo: Path, *args: str) -> bytes:
    return subprocess.run(
        ["git", *args],
        cwd=repo, check=True, stdout=subprocess.PIPE,
    ).stdout


def blob_reason(repo: Path, name: str, object_id: bytes) -> str | None:
    return artifact_reason(name, git_output(repo, "cat-file", "blob", object_id.decode("ascii")))


def check_index(repo: Path) -> list[tuple[str, str]]:
    entries = git_output(repo, "ls-files", "--stage", "-z")
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
        reason = blob_reason(repo, name, object_id)
        if reason:
            findings.append((name, reason))
    return findings


def check_history(repo: Path) -> list[tuple[str, str]]:
    if git_output(repo, "rev-parse", "--is-shallow-repository").strip() == b"true":
        return [("HEAD", "history scan requires a full checkout (fetch-depth: 0)")]
    findings = []
    seen = set()
    for commit in git_output(repo, "rev-list", "HEAD").splitlines():
        entries = git_output(repo, "ls-tree", "-r", "-z", commit.decode("ascii"))
        for entry in entries.split(b"\0"):
            if not entry:
                continue
            metadata, raw_path = entry.split(b"\t", 1)
            _, object_type, object_id = metadata.split()
            identity = (raw_path, object_id)
            if identity in seen:
                continue
            seen.add(identity)
            name = raw_path.decode("utf-8", errors="surrogateescape")
            reason = (
                blob_reason(repo, name, object_id)
                if object_type == b"blob" else "submodule cannot be scanned"
            )
            if reason:
                findings.append((f"{commit.decode('ascii')}:{name}", reason))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--history", action="store_true", help="Also scan every commit reachable from HEAD.")
    args = parser.parse_args()
    findings = check_index(args.repo)
    if args.history:
        findings.extend(check_history(args.repo))
    scope = "git-index-and-HEAD-history" if args.history else "git-index"
    print(json.dumps({"scope": scope, "findings": findings}, ensure_ascii=True))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
