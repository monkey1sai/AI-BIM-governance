#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import errno
import json
import os
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    # dataclasses and other runtime introspection resolve annotations through
    # sys.modules while the module is executing.
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


resolver = load_module("resolve_pr_contract", REPO_ROOT / "scripts" / "agent" / "resolve_pr_contract.py")
lifecycle = load_module("ephemeral_validation", REPO_ROOT / "scripts" / "agent" / "ephemeral_validation.py")


SHA_A = "a" * 40
SHA_B = "b" * 40
REPOSITORY = "monkey1sai/AI-BIM-governance"


def handoff(**overrides: str) -> str:
    values = {
        "Cloud task ID / URL": "codex-cloud-task-471",
        "Issue": "#251",
        "Cloud base SHA": SHA_A,
        "Expected touch set": "scripts/agent/**, .github/workflows/local-*.yml",
        "Local validation profile": "contracts",
        "Local-only checks outstanding": "Kit/WebRTC runtime",
        "Deployment requirement": "required after merge from protected main",
    }
    values.update(overrides)
    return "\n".join(f"{key}: {value}" for key, value in values.items())


class ContractResolverTests(unittest.TestCase):
    def test_plain_handoff_resolves_to_non_executable_contract(self) -> None:
        contract = resolver.resolve_contract(
            handoff(), repository=REPOSITORY, pr_number=99, base_sha=SHA_A, candidate_sha=SHA_B
        )
        self.assertEqual("contracts", contract["local_validation_profile"])
        self.assertEqual("test-deploy-after-merge", contract["deployment_requirement"])
        self.assertEqual(["scripts/agent/**", ".github/workflows/local-*.yml"], contract["expected_touch_set"])
        self.assertEqual(64, len(contract["pr_body_sha256"]))

    def test_duplicate_field_is_rejected(self) -> None:
        body = handoff() + "\nLocal validation profile: full"
        with self.assertRaisesRegex(resolver.ContractError, "duplicate"):
            resolver.resolve_contract(
                body, repository=REPOSITORY, pr_number=99, base_sha=SHA_A, candidate_sha=SHA_B
            )

    def test_unknown_profile_and_command_like_touch_set_are_rejected(self) -> None:
        with self.assertRaisesRegex(resolver.ContractError, "unknown local validation profile"):
            resolver.resolve_contract(
                handoff(**{"Local validation profile": "full; pwsh evil.ps1"}),
                repository=REPOSITORY,
                pr_number=99,
                base_sha=SHA_A,
                candidate_sha=SHA_B,
            )
        with self.assertRaisesRegex(resolver.ContractError, "unsafe touch-set"):
            resolver.resolve_contract(
                handoff(**{"Expected touch set": "../production/**"}),
                repository=REPOSITORY,
                pr_number=99,
                base_sha=SHA_A,
                candidate_sha=SHA_B,
            )

    def test_markdown_table_does_not_impersonate_stable_plain_fields(self) -> None:
        body = "\n".join(f"| {key} | value |" for key in resolver.FIELDS)
        with self.assertRaisesRegex(resolver.ContractError, "missing PR handoff"):
            resolver.resolve_contract(
                body, repository=REPOSITORY, pr_number=99, base_sha=SHA_A, candidate_sha=SHA_B
            )

    def test_issue_url_is_same_repo_and_negated_touch_globs_are_rejected(self) -> None:
        with self.assertRaisesRegex(resolver.ContractError, "current repository"):
            resolver.resolve_contract(
                handoff(**{"Issue": "https://github.com/other/project/issues/251"}),
                repository=REPOSITORY,
                pr_number=99,
                base_sha=SHA_A,
                candidate_sha=SHA_B,
            )

    def test_cloud_base_sha_must_match_current_protected_base(self) -> None:
        with self.assertRaisesRegex(resolver.ContractError, "current protected PR base SHA"):
            resolver.resolve_contract(
                handoff(),
                repository=REPOSITORY,
                pr_number=99,
                base_sha=SHA_B,
                candidate_sha=SHA_B,
            )
        with self.assertRaisesRegex(resolver.ContractError, "unsupported touch-set"):
            resolver.resolve_contract(
                handoff(**{"Expected touch set": "**, !scripts/deploy.ps1"}),
                repository=REPOSITORY,
                pr_number=99,
                base_sha=SHA_A,
                candidate_sha=SHA_B,
            )


class LifecyclePolicyTests(unittest.TestCase):
    def test_controller_and_candidate_repo_are_rejected_in_both_overlap_directions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            controller = root / "controller"
            nested_candidate = controller / "candidate-mirror"
            nested_candidate.mkdir(parents=True)
            with self.assertRaises(lifecycle.LifecycleError) as captured:
                lifecycle.validate_repository_separation(controller, nested_candidate)
            self.assertEqual("CANDIDATE_GIT_REPO_NOT_SEPARATE", captured.exception.error_code)

            outer_candidate = root / "candidate-parent"
            nested_controller = outer_candidate / "sealed-controller"
            nested_controller.mkdir(parents=True)
            with self.assertRaises(lifecycle.LifecycleError) as captured:
                lifecycle.validate_repository_separation(nested_controller, outer_candidate)
            self.assertEqual("CANDIDATE_GIT_REPO_NOT_SEPARATE", captured.exception.error_code)

    def test_protected_workspace_intersection_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            controller = root / "controller"
            protected = root / "production"
            controller.mkdir()
            protected.mkdir()
            with self.assertRaises(lifecycle.LifecycleError) as captured:
                lifecycle.validate_workspace_root(controller, protected / "candidate", [str(protected)])
            self.assertEqual(lifecycle.EXIT_UNSAFE_PATH, captured.exception.code)

    def test_evidence_root_must_not_contain_candidate_or_workspace_roots(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            controller = root / "controller"
            candidate = root / "candidate"
            workspace = root / "workspace"
            for path in (controller, candidate, workspace):
                path.mkdir()
            with self.assertRaises(lifecycle.LifecycleError) as captured:
                lifecycle.validate_evidence_root(
                    controller,
                    candidate,
                    workspace,
                    root,
                    [],
                )
            self.assertEqual("EVIDENCE_ROOT_NOT_ISOLATED", captured.exception.error_code)

    def test_profile_allowlist_has_only_normalized_public_keys(self) -> None:
        payload = json.loads(
            (REPO_ROOT / "scripts" / "agent" / "validation-profiles.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            {"contracts", "integration", "browser-e2e", "kit-runtime", "full"},
            set(payload["profiles"]),
        )
        self.assertNotIn("full-system", payload["profiles"])
        for profile in payload["profiles"].values():
            self.assertTrue(profile["locks"])
            for step in profile["steps"] + profile.get("cleanup_steps", []):
                self.assertIsInstance(step["command"], list)
                self.assertIn(step["command"][0], lifecycle.TRUSTED_EXECUTABLE_TOKENS)
                self.assertNotIn("shell", step)
        for profile_name in ("kit-runtime", "full"):
            self.assertEqual(
                ["kit-runtime-image-cleanup"],
                [step["name"] for step in payload["profiles"][profile_name]["cleanup_steps"]],
            )
            runtime_step = next(
                step
                for step in payload["profiles"][profile_name]["steps"]
                if step["name"] == "real-ifc-webrtc-runtime"
            )
            self.assertIn(
                {
                    "type": "file_not_writable",
                    "path": "{evidence_dir}/broker-sealed/real-runtime-evidence.json",
                },
                runtime_step["assertions"],
            )
            self.assertEqual(
                ["artifacts.0", "artifacts.1"],
                [
                    assertion["selector"]
                    for assertion in runtime_step["assertions"]
                    if assertion["type"] == "artifact_sha256"
                ],
            )

    def test_trusted_python_and_step_executable_are_absolute(self) -> None:
        python = Path(lifecycle.trusted_python(REPO_ROOT))
        self.assertTrue(python.is_absolute())
        self.assertTrue(python.is_file())

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            evidence = root / "evidence"
            workspace.mkdir()
            evidence.mkdir()
            context = {
                "python": "python",
                "evidence_dir": str(evidence),
            }
            with self.assertRaises(lifecycle.LifecycleError) as captured:
                lifecycle.run_step(
                    {"name": "relative-tool", "command": ["{python}", "--version"]},
                    workspace=workspace,
                    context=context,
                    environment=os.environ.copy(),
                    evidence=evidence,
                    events=lifecycle.EventLog(evidence / "events.ndjson"),
                )
            self.assertEqual("HOST_TOOL_NOT_FOUND", captured.exception.error_code)

    def test_candidate_environment_does_not_disclose_evidence_or_real_storage(self) -> None:
        context = {"compose_project": "isolated", "evidence_dir": "/trusted/evidence"}
        args = SimpleNamespace(invocation_id="invocation-1", candidate_sha=SHA_B)
        environment = lifecycle.child_environment(
            context=context,
            args=args,
            profile="contracts",
            storage_root=Path("/trusted/storage"),
        )
        self.assertNotIn("AI_BIM_VALIDATION_EVIDENCE_DIR", environment)
        self.assertNotIn("AI_BIM_REAL_STORAGE_ROOT", environment)

    def test_file_not_writable_assertion_accepts_effective_write_denial(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            evidence = root / "evidence"
            workspace.mkdir()
            evidence.mkdir()
            runtime_evidence = evidence / "runtime.json"
            runtime_evidence.write_text("{}\n", encoding="utf-8")
            real_open = lifecycle.os.open

            def deny_runtime_file(path, flags, *args, **kwargs):
                if Path(path) == runtime_evidence:
                    raise OSError(errno.EACCES, "denied")
                return real_open(path, flags, *args, **kwargs)

            step = {
                "name": "sealed-runtime-evidence",
                "command": ["{python}", "-c", "pass"],
                "assertions": [
                    {"type": "file_not_writable", "path": "{evidence_dir}/runtime.json"}
                ],
            }
            with mock.patch.object(lifecycle.os, "open", side_effect=deny_runtime_file):
                record = lifecycle.run_step(
                    step,
                    workspace=workspace,
                    context={
                        "python": str(Path(sys.executable).resolve()),
                        "evidence_dir": str(evidence),
                    },
                    environment=os.environ.copy(),
                    evidence=evidence,
                    events=lifecycle.EventLog(evidence / "events.ndjson"),
                )
            self.assertEqual(0, record["exit_code"])

    def test_broker_artifact_hash_is_recomputed_from_sealed_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            evidence = Path(temporary) / "evidence"
            sealed = evidence / "broker-sealed"
            sealed.mkdir(parents=True)
            artifact = sealed / "webrtc-first-frame.png"
            artifact.write_bytes(b"observed-frame")
            manifest = sealed / "real-runtime-evidence.json"
            manifest.write_text(
                json.dumps(
                    {
                        "artifacts": [
                            {
                                "name": artifact.name,
                                "sha256": lifecycle.sha256_file(artifact),
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            with (
                mock.patch.object(lifecycle, "require_file_not_writable"),
                mock.patch.object(lifecycle, "require_directory_not_writable"),
            ):
                lifecycle.assert_artifact_sha256(manifest, "artifacts.0", evidence)
                artifact.write_bytes(b"tampered-frame")
                with self.assertRaisesRegex(ValueError, "SHA-256 differs"):
                    lifecycle.assert_artifact_sha256(manifest, "artifacts.0", evidence)

    def test_runtime_harness_snapshot_covers_existing_sibling_modules(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary) / "broker"
            bundle.mkdir()
            launcher = bundle / "broker.exe"
            module = bundle / "broker_config.json"
            launcher.write_bytes(b"launcher-v1")
            module.write_text('{"mode":"sealed"}\n', encoding="utf-8")
            with (
                mock.patch.object(lifecycle, "require_file_not_writable"),
                mock.patch.object(lifecycle, "require_directory_not_writable"),
            ):
                before = lifecycle.snapshot_sealed_tree(bundle, label="runtime broker")
                module.write_text('{"mode":"tampered"}\n', encoding="utf-8")
                after = lifecycle.snapshot_sealed_tree(bundle, label="runtime broker")
            self.assertIn("broker.exe", before)
            self.assertIn("broker_config.json", before)
            self.assertNotEqual(before, after)

    def test_runner_owned_evidence_tampering_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result = Path(temporary) / "result.json"
            result.write_text('{"status":"running"}\n', encoding="utf-8")
            snapshot = lifecycle.snapshot_protected_evidence([result])
            result.write_text('{"status":"passed"}\n', encoding="utf-8")
            with self.assertRaises(lifecycle.LifecycleError) as captured:
                lifecycle.verify_protected_evidence(snapshot)
            self.assertEqual("EVIDENCE_TAMPERING_DETECTED", captured.exception.error_code)


class FileMutexTests(unittest.TestCase):
    def test_process_termination_releases_slot_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            lock_path = Path(temporary) / "slot-0.lock"
            module_path = REPO_ROOT / "scripts" / "agent" / "ephemeral_validation.py"
            holder_code = "\n".join(
                [
                    "import importlib.util, sys, time",
                    "spec = importlib.util.spec_from_file_location('lease_holder', sys.argv[1])",
                    "module = importlib.util.module_from_spec(spec)",
                    "sys.modules['lease_holder'] = module",
                    "spec.loader.exec_module(module)",
                    "mutex = module.FileMutex(module.Path(sys.argv[2])).acquire()",
                    "print('locked', flush=True)",
                    "time.sleep(30)",
                ]
            )
            holder = subprocess.Popen(
                [sys.executable, "-c", holder_code, str(module_path), str(lock_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                self.assertEqual("locked", holder.stdout.readline().strip())
                with self.assertRaises(lifecycle.LifecycleError):
                    lifecycle.FileMutex(lock_path).acquire(timeout_seconds=0.1)
            finally:
                if holder.poll() is None:
                    holder.kill()
                holder.communicate(timeout=5)

            recovered = lifecycle.FileMutex(lock_path).acquire(timeout_seconds=2)
            recovered.release()

    def test_lease_scan_reaches_free_high_capacity_slot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            group_root = root / ".leases" / "capacity-test"
            holders = [lifecycle.FileMutex(group_root / f"slot-{index}.lock").acquire() for index in range(31)]
            try:
                lease = lifecycle.Lease(
                    root=root,
                    spec=lifecycle.LeaseSpec("capacity-test", 32, 1),
                    invocation_id="capacity-test",
                    workspace=root / "workspace",
                    events=lifecycle.EventLog(root / "events.ndjson"),
                ).acquire()
                self.assertEqual(31, lease.slot_index)
                lease.release()
            finally:
                for holder in reversed(holders):
                    holder.release()

    def test_event_failure_rolls_back_slot_ownership(self) -> None:
        class FailingEvents:
            def write(self, _event: str, **_data: object) -> None:
                raise OSError("injected event failure")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            broken = lifecycle.Lease(
                root=root,
                spec=lifecycle.LeaseSpec("rollback-test", 1, 1),
                invocation_id="broken",
                workspace=root / "broken",
                events=FailingEvents(),
            )
            with self.assertRaises(lifecycle.LifecycleError) as captured:
                broken.acquire()
            self.assertEqual("LEASE_INITIALIZATION_FAILED", captured.exception.error_code)

            recovered = lifecycle.Lease(
                root=root,
                spec=lifecycle.LeaseSpec("rollback-test", 1, 1),
                invocation_id="recovered",
                workspace=root / "recovered",
                events=lifecycle.EventLog(root / "events.ndjson"),
            ).acquire()
            recovered.release()
            self.assertFalse(list((root / ".leases").rglob("*.owner.json")))

    def test_owner_mismatch_fails_cleanup_but_unlocks_slot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lease = lifecycle.Lease(
                root=root,
                spec=lifecycle.LeaseSpec("owner-test", 1, 1),
                invocation_id="owner",
                workspace=root / "owner",
                events=lifecycle.EventLog(root / "events.ndjson"),
            ).acquire()
            assert lease.owner_path is not None
            owner = json.loads(lease.owner_path.read_text(encoding="utf-8"))
            owner["token"] = "tampered"
            lifecycle.atomic_write_json(lease.owner_path, owner)
            with self.assertRaises(lifecycle.LifecycleError) as captured:
                lease.release()
            self.assertEqual("LEASE_OWNER_CHANGED", captured.exception.error_code)

            recovered = lifecycle.Lease(
                root=root,
                spec=lifecycle.LeaseSpec("owner-test", 1, 1),
                invocation_id="recovered",
                workspace=root / "recovered",
                events=lifecycle.EventLog(root / "recovered-events.ndjson"),
            ).acquire()
            recovered.release()


if __name__ == "__main__":
    unittest.main()
