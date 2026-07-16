#!/usr/bin/env python3
"""Adversarial stress test for the real ephemeral validation controller core."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
LIFECYCLE = REPO_ROOT / "scripts" / "agent" / "ephemeral_validation.py"


PROBE = r'''#!/usr/bin/env python3
import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

parser = argparse.ArgumentParser()
parser.add_argument("--mode", required=True)
parser.add_argument("--shared-root", required=True, type=Path)
parser.add_argument("--hold", type=float, default=0.2)
args = parser.parse_args()
invocation = os.environ.get("AI_BIM_VALIDATION_INVOCATION_ID", "missing")
root = args.shared_root
active = root / "active" / invocation
runtime_marker = root / "runtime-exclusive.marker"
events = root / "probe-events"
events.mkdir(parents=True, exist_ok=True)

if args.mode == "cleanup":
    if active.exists():
        active.unlink()
    if runtime_marker.exists():
        try:
            owner = runtime_marker.read_text(encoding="utf-8")
            if owner == invocation:
                runtime_marker.unlink()
        except FileNotFoundError:
            pass
    raise SystemExit(0)

if os.environ.get("STRESS_SECRET_TOKEN"):
    (root / "SECRET_LEAKED").write_text(os.environ["STRESS_SECRET_TOKEN"], encoding="utf-8")
    raise SystemExit(74)

active.parent.mkdir(parents=True, exist_ok=True)
active.write_text(args.mode, encoding="utf-8")
runtime_owned = False
try:
    if args.mode == "runtime":
        try:
            fd = os.open(runtime_marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            (root / "RUNTIME_COLLISION").touch()
            raise SystemExit(73)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(invocation)
        runtime_owned = True
    (events / f"{invocation}.start.json").write_text(json.dumps({"at": now(), "mode": args.mode}), encoding="utf-8")
    time.sleep(args.hold)
    if args.mode == "fail":
        raise SystemExit(37)
finally:
    (events / f"{invocation}.finish.json").write_text(json.dumps({"at": now(), "mode": args.mode}), encoding="utf-8")
    if active.exists():
        active.unlink()
    if runtime_owned and runtime_marker.exists():
        runtime_marker.unlink()
'''


def run(command: list[str], *, cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and completed.returncode != 0:
        raise RuntimeError(f"command failed ({completed.returncode}): {' '.join(command)}\n{completed.stderr}")
    return completed


def git(repo: Path, *args: str) -> str:
    return run(["git", "-C", str(repo), *args]).stdout.strip()


def atomic_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def setup_synthetic(root: Path) -> tuple[Path, str, str, Path, Path, Path]:
    controller = root / "controller"
    shared = root / "shared"
    workspace = root / "workspaces"
    evidence = root / "evidence"
    fake_production = root / "fake-production"
    controller.mkdir(parents=True)
    shared.mkdir()
    fake_production.mkdir()
    (fake_production / "DO_NOT_TOUCH").write_text("production-sentinel\n", encoding="utf-8")

    run(["git", "init", "-b", "main", str(controller)])
    git(controller, "config", "user.email", "stress@example.invalid")
    git(controller, "config", "user.name", "Ephemeral Stress")
    (controller / "probe.py").write_text(PROBE, encoding="utf-8")
    (controller / "allowed").mkdir()
    (controller / "allowed" / "base.txt").write_text("base\n", encoding="utf-8")
    git(controller, "add", ".")
    git(controller, "commit", "-m", "stress base")
    base_sha = git(controller, "rev-parse", "HEAD")
    (controller / "allowed" / "change.txt").write_text("candidate\n", encoding="utf-8")
    git(controller, "add", "allowed/change.txt")
    git(controller, "commit", "-m", "stress candidate")
    candidate_sha = git(controller, "rev-parse", "HEAD")
    return controller, base_sha, candidate_sha, shared, workspace, evidence


def profile_step(mode: str, shared: Path, hold: float, timeout: int = 10) -> dict[str, Any]:
    return {
        "name": f"probe-{mode}",
        "cwd": ".",
        "timeout_seconds": timeout,
        "command": [
            "{python}", "probe.py", "--mode", mode,
            "--shared-root", str(shared), "--hold", str(hold),
        ],
    }


def cleanup_step(shared: Path) -> dict[str, Any]:
    return {
        "name": "probe-cleanup",
        "cwd": ".",
        "timeout_seconds": 10,
        "command": ["{python}", "probe.py", "--mode", "cleanup", "--shared-root", str(shared)],
    }


def write_profiles(path: Path, shared: Path, fake_production: Path, hold: float) -> None:
    nonruntime = {"group": "non-runtime", "capacity": 2, "wait_timeout_seconds": 30}
    runtime = {"group": "runtime", "capacity": 1, "wait_timeout_seconds": 30}
    profiles = {
        "schema_version": "stress/v1",
        "protected_workspace_roots": [str(fake_production)],
        "metadata_lock": {"group": "git-metadata", "capacity": 1, "wait_timeout_seconds": 30},
        "profiles": {
            "normal": {"locks": [nonruntime], "steps": [profile_step("normal", shared, hold)], "cleanup_steps": [cleanup_step(shared)]},
            "runtime": {"locks": [runtime], "steps": [profile_step("runtime", shared, hold / 2)], "cleanup_steps": [cleanup_step(shared)]},
            "fail": {"locks": [nonruntime], "steps": [profile_step("fail", shared, hold)], "cleanup_steps": [cleanup_step(shared)]},
            "timeout": {"locks": [nonruntime], "steps": [profile_step("normal", shared, 5, timeout=1)], "cleanup_steps": [cleanup_step(shared)]},
        },
    }
    atomic_json(path, profiles)


def write_contract(path: Path, *, profile: str, pr: int, base: str, candidate: str, touch: list[str] | None = None) -> None:
    atomic_json(
        path,
        {
            "schema_version": "ai-bim-task-contract/v1",
            "task_id": f"stress-task-{pr}",
            "issue": pr,
            "pr_number": pr,
            "repository": "stress/local",
            "pr_body_sha256": hashlib.sha256(f"stress-{pr}".encode("utf-8")).hexdigest(),
            "cloud_base_sha": base,
            "base_sha": base,
            "candidate_sha": candidate,
            "expected_touch_set": touch or ["allowed/**"],
            "local_validation_profile": profile,
            "local_only_checks_outstanding": "synthetic lifecycle probe",
            "deployment_requirement": "none",
        },
    )


def result_path(evidence: Path, pr: int, run_id: str, attempt: int, invocation: str) -> Path:
    return evidence / f"pr-{pr}" / f"run-{run_id}-attempt-{attempt}" / f"invocation-{invocation}" / "result.json"


def invoke(
    *, controller: Path, base: str, candidate: str, profiles: Path, contract: Path | None,
    profile: str | None, pr: int, run_id: str, attempt: int, invocation: str,
    workspace: Path, evidence: Path, environment: dict[str, str] | None = None,
) -> dict[str, Any]:
    command = [
        sys.executable, str(LIFECYCLE),
        "--controller-repo", str(controller),
        "--base-sha", base,
        "--candidate-sha", candidate,
        "--pr-number", str(pr),
        "--run-id", run_id,
        "--attempt", str(attempt),
        "--invocation-id", invocation,
        "--workspace-root", str(workspace),
        "--evidence-root", str(evidence),
        "--profiles-path", str(profiles),
        "--test-mode",
    ]
    if contract is not None:
        command += ["--task-contract", str(contract)]
    if profile is not None:
        command += ["--profile", profile]
    child_env = os.environ.copy()
    if environment:
        child_env.update(environment)
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", env=child_env)
    path = result_path(evidence, pr, run_id, attempt, invocation)
    payload = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "result_path": str(path),
        "result": payload,
        "pr": pr,
        "run_id": run_id,
        "attempt": attempt,
        "invocation": invocation,
    }


def parse_time(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def max_overlap(intervals: list[tuple[float, float]]) -> int:
    points: list[tuple[float, int]] = []
    for start, finish in intervals:
        points.extend(((start, 1), (finish, -1)))
    active = maximum = 0
    for _, delta in sorted(points, key=lambda item: (item[0], item[1])):
        active += delta
        maximum = max(maximum, active)
    return maximum


def lease_overlap(evidence: Path, group: str) -> int:
    intervals: list[tuple[float, float]] = []
    for event_path in evidence.rglob("events.ndjson"):
        acquired: list[float] = []
        for line in event_path.read_text(encoding="utf-8").splitlines():
            event = json.loads(line)
            if event.get("group") != group:
                continue
            if event.get("event") == "lease_acquired":
                acquired.append(parse_time(event["timestamp"]))
            elif event.get("event") == "lease_released" and acquired:
                intervals.append((acquired.pop(0), parse_time(event["timestamp"])))
    return max_overlap(intervals)


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def lease_slots(workspace: Path) -> list[str]:
    lease_root = workspace / ".leases"
    owners = [path for path in lease_root.glob("*/slot-*.owner.json") if path.is_file()]
    temporaries = [path for path in lease_root.glob("*/.slot-*.owner.json.*.tmp") if path.is_file()]
    return [str(path) for path in owners + temporaries]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--iterations", type=int, default=32)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--runtime-iterations", type=int, default=8)
    parser.add_argument("--failure-iterations", type=int, default=4)
    parser.add_argument("--timeout-iterations", type=int, default=2)
    parser.add_argument("--hold-seconds", type=float, default=0.35)
    # The fixture creates its own repository and many detached worktrees. Keep
    # it outside the repository under test; nesting synthetic worktrees inside
    # a real linked worktree produces platform-specific Git/filesystem races.
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path(tempfile.gettempdir()) / "ai-bim-ephemeral-validation-stress",
    )
    args = parser.parse_args(argv)
    if args.iterations < args.runtime_iterations + args.failure_iterations + args.timeout_iterations + 2:
        parser.error("iterations must leave at least two normal validations")
    if args.workers < 2:
        parser.error("workers must be at least 2")

    output = args.output_root.resolve(strict=False)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    fixture = output / "fixture"
    fixture.mkdir()
    controller, base, candidate, shared, workspace, evidence = setup_synthetic(fixture)
    fake_production = fixture / "fake-production"
    sentinel = fake_production / "DO_NOT_TOUCH"
    sentinel_before = file_hash(sentinel)
    profiles = fixture / "profiles.json"
    write_profiles(profiles, shared, fake_production, args.hold_seconds)
    contracts = fixture / "contracts"
    contracts.mkdir()

    baseline_worktrees = git(controller, "worktree", "list", "--porcelain")
    baseline_head = git(controller, "rev-parse", "HEAD")
    baseline_status = git(controller, "status", "--porcelain")
    secret_canary = "AI_BIM_STRESS_SECRET_7f31b52c"

    counts = {
        "runtime": args.runtime_iterations,
        "fail": args.failure_iterations,
        "timeout": args.timeout_iterations,
    }
    counts["normal"] = args.iterations - sum(counts.values())
    jobs: list[dict[str, Any]] = []
    index = 0
    for profile, count in counts.items():
        for _ in range(count):
            pr = 1000 + index
            run_id = f"stress-{index:03d}"
            invocation = f"inv-{index:03d}"
            contract = contracts / f"{invocation}.json"
            write_contract(contract, profile=profile, pr=pr, base=base, candidate=candidate)
            jobs.append(
                dict(
                    controller=controller, base=base, candidate=candidate, profiles=profiles,
                    contract=contract, profile=None, pr=pr, run_id=run_id, attempt=1,
                    invocation=invocation, workspace=workspace, evidence=evidence,
                    environment={"STRESS_SECRET_TOKEN": secret_canary},
                )
            )
            index += 1

    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        results = list(executor.map(lambda kwargs: invoke(**kwargs), jobs))
    elapsed = time.monotonic() - started

    expected = {
        "normal": (0, "passed"),
        "runtime": (0, "passed"),
        "fail": (30, "failed"),
        "timeout": (31, "timeout"),
    }
    unexpected: list[str] = []
    for job, observed in zip(jobs, results):
        profile = json.loads(Path(job["contract"]).read_text(encoding="utf-8"))["local_validation_profile"]
        expected_code, expected_status = expected[profile]
        status = (observed["result"] or {}).get("status")
        cleanup = (observed["result"] or {}).get("cleanup_status")
        if observed["returncode"] != expected_code or status != expected_status or cleanup != "succeeded":
            unexpected.append(
                f"{observed['invocation']}: expected ({expected_code},{expected_status},succeeded) "
                f"got ({observed['returncode']},{status},{cleanup}) stderr={observed['stderr'][-300:]}"
            )
    slots_after_primary = lease_slots(workspace)
    if slots_after_primary:
        unexpected.append(f"lease slots remained after primary runs: {slots_after_primary}")

    # At-least-once delivery: one identity may run only once; duplicates leave evidence and fail closed.
    duplicate_pr = 9000
    duplicate_run = "duplicate-001"
    duplicate_contract = contracts / "duplicate.json"
    write_contract(duplicate_contract, profile="normal", pr=duplicate_pr, base=base, candidate=candidate)
    duplicate_jobs = [
        dict(
            controller=controller, base=base, candidate=candidate, profiles=profiles,
            contract=duplicate_contract, profile=None, pr=duplicate_pr, run_id=duplicate_run,
            attempt=1, invocation=f"dup-{i}", workspace=workspace, evidence=evidence,
            environment={"STRESS_SECRET_TOKEN": secret_canary},
        )
        for i in range(4)
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        duplicate_results = list(executor.map(lambda kwargs: invoke(**kwargs), duplicate_jobs))
    duplicate_codes = sorted(item["returncode"] for item in duplicate_results)
    if duplicate_codes != [0, 20, 20, 20]:
        unexpected.append(f"duplicate delivery codes: {duplicate_codes}")
    slots_after_duplicates = lease_slots(workspace)
    if slots_after_duplicates:
        unexpected.append(f"lease slots remained after duplicate delivery: {slots_after_duplicates}")

    # Kill a real lease holder without calling release. The kernel must release
    # its slot lock and leave only diagnostic owner metadata to reap.
    stale_root = workspace / ".leases" / "non-runtime"
    stale_root.mkdir(parents=True, exist_ok=True)
    holder_code = "\n".join(
        [
            "import importlib.util, sys, time",
            "spec = importlib.util.spec_from_file_location('stress_lease_holder', sys.argv[1])",
            "module = importlib.util.module_from_spec(spec)",
            "sys.modules['stress_lease_holder'] = module",
            "spec.loader.exec_module(module)",
            "root = module.Path(sys.argv[2])",
            "lease = module.Lease(root=root, spec=module.LeaseSpec('non-runtime', 2, 30), invocation_id='crashed-0', workspace=root / 'crashed', events=module.EventLog(root / 'crash-holder-events.ndjson')).acquire()",
            "print(f'locked:{lease.slot_index}', flush=True)",
            "time.sleep(60)",
        ]
    )
    holder = subprocess.Popen(
        [sys.executable, "-c", holder_code, str(LIFECYCLE), str(workspace)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    killed_holder_started = False
    try:
        holder_line = holder.stdout.readline().strip()
        killed_holder_started = holder_line == "locked:0"
        if not killed_holder_started:
            unexpected.append(f"crash lease holder failed to start: {holder_line}")
    finally:
        if holder.poll() is None:
            holder.kill()
        _holder_stdout, holder_stderr = holder.communicate(timeout=5)
        if holder.returncode == 0:
            unexpected.append("crash lease holder exited normally instead of being killed")
        if not killed_holder_started and holder_stderr:
            unexpected.append(f"crash lease holder stderr: {holder_stderr[-300:]}")
    stale_pr = 9050
    stale_contract = contracts / "stale-recovery.json"
    write_contract(stale_contract, profile="normal", pr=stale_pr, base=base, candidate=candidate)
    stale_result = invoke(
        controller=controller, base=base, candidate=candidate, profiles=profiles,
        contract=stale_contract, profile=None, pr=stale_pr, run_id="stale-recovery", attempt=1,
        invocation="stale-recovery", workspace=workspace, evidence=evidence,
        environment={"STRESS_SECRET_TOKEN": secret_canary},
    )
    stale_events = Path(stale_result["result_path"]).with_name("events.ndjson")
    stale_reaped = stale_events.exists() and "stale_lease_reaped" in stale_events.read_text(encoding="utf-8")
    killed_lease_recovered = killed_holder_started and stale_result["returncode"] == 0 and stale_reaped
    if not killed_lease_recovered:
        unexpected.append("stale host leases were not recovered safely")
    slots_after_stale_recovery = lease_slots(workspace)
    if slots_after_stale_recovery:
        unexpected.append(f"lease slots remained after stale recovery: {slots_after_stale_recovery}")

    scope_pr = 9100
    scope_contract = contracts / "scope-reject.json"
    write_contract(scope_contract, profile="normal", pr=scope_pr, base=base, candidate=candidate, touch=["forbidden/**"])
    scope_result = invoke(
        controller=controller, base=base, candidate=candidate, profiles=profiles,
        contract=scope_contract, profile=None, pr=scope_pr, run_id="scope-reject", attempt=1,
        invocation="scope-reject", workspace=workspace, evidence=evidence,
        environment={"STRESS_SECRET_TOKEN": secret_canary},
    )
    if scope_result["returncode"] != 21 or (scope_result["result"] or {}).get("error_code") != "SCOPE_VIOLATION":
        unexpected.append("scope violation did not fail closed with code 21")
    slots_after_scope = lease_slots(workspace)

    unknown = invoke(
        controller=controller, base=base, candidate=candidate, profiles=profiles,
        contract=None, profile="full-pwsh-injection", pr=9200, run_id="unknown-profile", attempt=1,
        invocation="unknown-profile", workspace=workspace, evidence=evidence,
        environment={"STRESS_SECRET_TOKEN": secret_canary},
    )
    if unknown["returncode"] != 20:
        unexpected.append(f"unknown profile returned {unknown['returncode']} instead of 20")
    slots_after_unknown = lease_slots(workspace)

    protected = invoke(
        controller=controller, base=base, candidate=candidate, profiles=profiles,
        contract=None, profile="normal", pr=9300, run_id="protected-path", attempt=1,
        invocation="protected-path", workspace=fake_production, evidence=evidence,
        environment={"STRESS_SECRET_TOKEN": secret_canary},
    )
    if protected["returncode"] != 22:
        unexpected.append(f"protected path returned {protected['returncode']} instead of 22")
    slots_after_protected = lease_slots(workspace)

    final_worktrees = git(controller, "worktree", "list", "--porcelain")
    final_head = git(controller, "rev-parse", "HEAD")
    final_status = git(controller, "status", "--porcelain")
    fsck_code = run(["git", "-C", str(controller), "fsck", "--no-progress"], check=False).returncode
    orphan_workspaces = [str(path) for path in workspace.glob("pr-*/*") if path.is_dir()]
    active_markers = [str(path) for path in (shared / "active").glob("*")] if (shared / "active").exists() else []
    orphan_lease_slots = lease_slots(workspace)

    valid_results = [item["result"] for item in results if item["result"]]
    normal_intervals = [
        (parse_time(item["validation_started_at"]), parse_time(item["validation_finished_at"]))
        for item in valid_results if item["profile"] in {"normal", "fail", "timeout"}
    ]
    runtime_intervals = [
        (parse_time(item["validation_started_at"]), parse_time(item["validation_finished_at"]))
        for item in valid_results if item["profile"] == "runtime"
    ]
    secret_matches = 0
    for path in output.rglob("*"):
        if path.is_file():
            try:
                secret_matches += path.read_text(encoding="utf-8", errors="ignore").count(secret_canary)
            except OSError:
                pass

    metrics = {
        "unexpected_failures": len(unexpected),
        "unexpected_details": unexpected,
        "iterations": args.iterations,
        "workers": args.workers,
        "elapsed_seconds": round(elapsed, 3),
        "result_parse_count": len(valid_results),
        "cleanup_success_count": sum(item.get("cleanup_status") == "succeeded" for item in valid_results),
        "normal_validation_max_concurrency": max_overlap(normal_intervals),
        "runtime_validation_max_concurrency": max_overlap(runtime_intervals),
        "metadata_lock_max_holders": lease_overlap(evidence, "git-metadata"),
        "non_runtime_lock_max_holders": lease_overlap(evidence, "non-runtime"),
        "runtime_lock_max_holders": lease_overlap(evidence, "runtime"),
        "runtime_collision_count": int((shared / "RUNTIME_COLLISION").exists()),
        "orphan_directory_count": len(orphan_workspaces),
        "orphan_git_registration_count": int(final_worktrees != baseline_worktrees),
        "active_probe_marker_count": len(active_markers),
        "orphan_lease_slot_count": len(orphan_lease_slots),
        "slots_after_primary_count": len(slots_after_primary),
        "slots_after_duplicate_count": len(slots_after_duplicates),
        "slots_after_stale_recovery_count": len(slots_after_stale_recovery),
        "slots_after_scope_count": len(slots_after_scope),
        "slots_after_unknown_count": len(slots_after_unknown),
        "slots_after_protected_count": len(slots_after_protected),
        "secret_canary_matches": secret_matches,
        "deployment_sentinel_changed": file_hash(sentinel) != sentinel_before,
        "controller_head_changed": final_head != baseline_head,
        "controller_status_changed": final_status != baseline_status,
        "git_fsck_exit_code": fsck_code,
        "duplicate_delivery_codes": duplicate_codes,
        "scope_rejection_code": scope_result["returncode"],
        "unknown_profile_code": unknown["returncode"],
        "protected_path_code": protected["returncode"],
        "stale_lease_recovered": stale_reaped,
        "killed_lease_holder_started": killed_holder_started,
        "killed_lease_recovered": killed_lease_recovered,
    }
    passed = (
        metrics["unexpected_failures"] == 0
        and metrics["result_parse_count"] == args.iterations
        and metrics["cleanup_success_count"] == args.iterations
        and metrics["normal_validation_max_concurrency"] >= 2
        and metrics["normal_validation_max_concurrency"] <= 2
        and metrics["runtime_validation_max_concurrency"] == 1
        and metrics["metadata_lock_max_holders"] == 1
        and metrics["non_runtime_lock_max_holders"] <= 2
        and metrics["runtime_lock_max_holders"] == 1
        and metrics["runtime_collision_count"] == 0
        and metrics["orphan_directory_count"] == 0
        and metrics["orphan_git_registration_count"] == 0
        and metrics["active_probe_marker_count"] == 0
        and metrics["orphan_lease_slot_count"] == 0
        and metrics["secret_canary_matches"] == 0
        and not metrics["deployment_sentinel_changed"]
        and not metrics["controller_head_changed"]
        and not metrics["controller_status_changed"]
        and metrics["git_fsck_exit_code"] == 0
        and metrics["duplicate_delivery_codes"] == [0, 20, 20, 20]
        and metrics["scope_rejection_code"] == 21
        and metrics["unknown_profile_code"] == 20
        and metrics["protected_path_code"] == 22
        and metrics["stale_lease_recovered"]
        and metrics["killed_lease_holder_started"]
        and metrics["killed_lease_recovered"]
    )
    summary = {
        "schema_version": "ai-bim-ephemeral-validation-stress/v1",
        "verdict": "passed" if passed else "failed",
        "generated_at": datetime.now().astimezone().isoformat(),
        "platform": sys.platform,
        "python": sys.version,
        "git": run(["git", "--version"]).stdout.strip(),
        "fixture_root": str(fixture),
        "baseline_worktrees": baseline_worktrees,
        "final_worktrees": final_worktrees,
        "metrics": metrics,
    }
    summary_path = output / "stress-summary.json"
    atomic_json(summary_path, summary)
    print(json.dumps({"verdict": summary["verdict"], "summary": str(summary_path), "metrics": metrics}, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
