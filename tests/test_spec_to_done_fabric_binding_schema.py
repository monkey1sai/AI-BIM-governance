import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "agent-contracts" / "spec-to-done-fabric-binding.schema.json"


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def binding() -> dict:
    binding_id = "a" * 64
    return {
        "schema_version": "spec-to-done-fabric-binding/v1",
        "binding_id": binding_id,
        "slug": "fabric-binding",
        "fabric_tuple": {
            "plan_id": "plan:binding-contract",
            "generation": 7,
            "task_id": "task:binding-one",
            "lease_id": "lease:binding-one",
            "owner_session": "session:writer-one",
            "provider": "codex",
            "scope_digest": "b" * 64,
            "baseline_sha": "c" * 40,
            "branch": "codex/feat/binding-one",
            "worktree_path_digest": "d" * 64,
        },
        "lease_state_at_binding": "ACTIVE",
        "source_digests": {
            "plan": "e" * 64,
            "task": "f" * 64,
            "lease": "0" * 64,
            "provider_session": "1" * 64,
        },
        "task_scope_resources": [
            {"kind": "path", "path": "agent-contracts"},
        ],
        "allowed_paths": [
            "agent-contracts/spec-to-done-fabric-binding.schema.json",
        ],
        "state_relative_path": f"artifacts/spec-to-done/fabric-binding--{binding_id}-state.md",
        "binding_relative_path": f"artifacts/spec-to-done/bindings/{binding_id}.json",
        "capacity_semantics": {
            "session_admission_limit": "unbounded",
            "run_writer_cardinality": 1,
            "requested_capacity_writers": "plan_local_request_only",
            "activation_writer_cap": "review_or_direct_stack_only",
        },
        "recovery_policy": {
            "held_lease_action": "retain_as_suspect",
            "local_new_run_allowed": False,
            "local_resume_allowed": False,
            "verified_resume_intent_required": True,
        },
        "delivery_authority": {
            "push": False,
            "approve": False,
            "merge": False,
            "deploy": False,
            "process_termination": False,
            "branch_protection_mutation": False,
            "review_migration": False,
            "direct_stack": False,
        },
    }


def validator() -> Draft202012Validator:
    schema = load_schema()
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def test_binding_schema_is_closed_and_accepts_the_canonical_packet() -> None:
    schema = load_schema()
    value = binding()
    assert schema["additionalProperties"] is False
    assert set(value) == set(schema["required"]) == set(schema["properties"])
    assert validator().is_valid(value)

    hostile = copy.deepcopy(value)
    hostile["unexpected"] = True
    assert not validator().is_valid(hostile)


def test_binding_schema_cannot_encode_a_repo_writer_cap_or_multiple_binding_writers() -> None:
    for field, value in (
        ("session_admission_limit", 2),
        ("session_admission_limit", "two"),
        ("run_writer_cardinality", 2),
        ("requested_capacity_writers", "repo_session_cap"),
        ("activation_writer_cap", "session_admission_cap"),
    ):
        hostile = binding()
        hostile["capacity_semantics"][field] = value
        assert not validator().is_valid(hostile), field


def test_binding_schema_rejects_local_recovery_and_delivery_authority_escalation() -> None:
    mutations = (
        ("recovery_policy", "local_new_run_allowed", True),
        ("recovery_policy", "local_resume_allowed", True),
        ("recovery_policy", "verified_resume_intent_required", False),
        ("delivery_authority", "push", True),
        ("delivery_authority", "merge", True),
        ("delivery_authority", "direct_stack", True),
    )
    for group, field, value in mutations:
        hostile = binding()
        hostile[group][field] = value
        assert not validator().is_valid(hostile), f"{group}.{field}"


def test_binding_schema_rejects_noncanonical_state_identity_and_path_scope() -> None:
    mutations = (
        ("lease_state_at_binding", "SUSPECT"),
        ("binding_id", "A" * 64),
        ("state_relative_path", "artifacts/spec-to-done/fabric-binding-state.md"),
        ("binding_relative_path", "artifacts/spec-to-done/bindings/current.json"),
        ("allowed_paths", ["../outside.md"]),
        ("allowed_paths", ["C:\\outside.md"]),
        ("allowed_paths", ["scripts/**/*.mjs"]),
    )
    for field, value in mutations:
        hostile = binding()
        hostile[field] = value
        assert not validator().is_valid(hostile), field


def test_binding_schema_matches_current_fabric_secret_and_identity_guards() -> None:
    mutations = (
        ("fabric_tuple", "plan_id", "plan:Bearer-secret"),
        ("fabric_tuple", "plan_id", "plan:Binding-Contract"),
        ("fabric_tuple", "branch", "constructor"),
    )
    for group, field, value in mutations:
        hostile = binding()
        hostile[group][field] = value
        assert not validator().is_valid(hostile), f"{group}.{field}"

    hostile_path = binding()
    hostile_path["allowed_paths"] = ["artifacts/token-value.json"]
    assert not validator().is_valid(hostile_path)


def test_binding_schema_accepts_current_fabric_resource_key_bound() -> None:
    value = binding()
    value["task_scope_resources"] = [
        {"kind": "shared_contract", "resource_key": "contract:" + "a" * 1023}
    ]
    assert validator().is_valid(value)
