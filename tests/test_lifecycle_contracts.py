"""Fail-closed and model-based tests for the lifecycle contracts (Phase 4).

Two protection layers, mirroring Phase 3:

* **Pinned literals.** The machine ids, state sets, forbidden shortcuts,
  evidence-gated transitions, source bindings, and the schema files'
  load-bearing constraints are pinned here as literals. A ratchet over a
  contract cannot detect the contract itself being loosened, so loosening it
  must require an edit to this file that is visible in the same diff.
* **Model-based properties.** The tests load the canonical contract as a
  transition system and assert properties over *every* enumerated path rather
  than hand-picked examples: forbidden pairs have no single-step edge, every
  pending-to-active path crosses the evidence gates, terminal states are
  closed, and every state is reachable or explicitly declared_only.
"""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.architecture_contract import validate_schema_instance  # noqa: E402
from scripts.lib.lifecycle_contracts import (  # noqa: E402
    CONTRACT_SCHEMA_VERSION,
    MachineModel,
    _extract_union_literals,
    check_lifecycle_contracts,
)


# --------------------------------------------------------------------------- #
# Pinned literals (loosening the contract must edit this file)
# --------------------------------------------------------------------------- #

PINNED_MACHINE_IDS = frozenset({"review-session", "endpoint-lease", "stage-binding"})

PINNED_STATES: dict[str, frozenset[str]] = {
    "review-session": frozenset({"created", "active", "closing", "closed", "failed"}),
    "endpoint-lease": frozenset({"active", "released", "expired"}),
    "stage-binding": frozenset({"pending", "executing", "active", "failed", "superseded"}),
}

PINNED_SOURCE_BINDINGS: dict[str, tuple[str, str]] = {
    "review-session": ("bim-review-coordinator/src/types.ts", "SessionStatus"),
    "endpoint-lease": (
        "bim-review-coordinator/src/services/viewerLeaseStore.ts",
        "ViewerLeaseStatus",
    ),
    "stage-binding": (
        "bim-review-coordinator/src/services/runtimeMutationAuthority/stageBindingState.ts",
        "StageBindingStatus",
    ),
}

PINNED_FORBIDDEN: frozenset[tuple[str, str, str]] = frozenset(
    {
        ("review-session", "created", "closed"),
        ("review-session", "active", "closed"),
        ("endpoint-lease", "released", "active"),
        ("endpoint-lease", "expired", "active"),
        ("stage-binding", "pending", "active"),
        ("stage-binding", "executing", "superseded"),
    }
)

PINNED_EVIDENCE_GATED_TRANSITIONS: dict[tuple[str, str], frozenset[str]] = {
    ("stage-binding", "kit-consume"): frozenset({"attempt-binding-match"}),
    ("stage-binding", "confirm-load-success"): frozenset(
        {"attempt-binding-match", "runtime-load-outcome"}
    ),
    ("stage-binding", "confirm-load-failure"): frozenset(
        {"attempt-binding-match", "runtime-load-outcome"}
    ),
}

PINNED_READINESS_EVIDENCE = frozenset(
    {"kit-process-alive", "opened-stage-result", "datachannel-ready", "first-frame-at", "stage-matched"}
)

PINNED_DECLARED_ONLY: frozenset[tuple[str, str]] = frozenset({("review-session", "failed")})

# Load-bearing constraints of the schema file. Replacing the schema with a stub
# must show up either here or in the checker's vacuous-schema guard.
PINNED_SCHEMA_TOP_REQUIRED = frozenset(
    {
        "$schema",
        "schema_version",
        "purpose",
        "enforcement_note",
        "machines",
        "cross_machine_rules",
        "readiness_binding",
    }
)
PINNED_SCHEMA_MACHINE_REQUIRED = frozenset(
    {
        "id",
        "title",
        "owner_service",
        "source_binding",
        "states",
        "transitions",
        "forbidden_shortcuts",
        "evidence",
        "notes",
    }
)
PINNED_SCHEMA_TRANSITION_REQUIRED = frozenset(
    {"id", "from", "to", "trigger", "evidence_required", "description"}
)
PINNED_SCHEMA_STATE_KINDS = ("initial", "intermediate", "terminal")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


CONTRACT_PATH = ROOT / "architecture" / "lifecycle-contract.json"
SCHEMA_PATH = ROOT / "architecture" / "lifecycle-contract.schema.json"
ARCHITECTURE_PATH = ROOT / "architecture" / "architecture-contract.json"
ARCHITECTURE_SCHEMA_PATH = ROOT / "architecture" / "architecture-contract.schema.json"


def load_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def load_architecture() -> dict:
    return json.loads(ARCHITECTURE_PATH.read_text(encoding="utf-8"))


def issue_codes(result) -> set[str]:
    return {issue.code for issue in result.issues}


def machine_by_id(contract: dict, machine_id: str) -> dict:
    return next(machine for machine in contract["machines"] if machine["id"] == machine_id)


def model_by_id(result, machine_id: str) -> MachineModel:
    return next(machine for machine in result.machines if machine.id == machine_id)


def build_tmp_repo(
    tmp_path: Path,
    *,
    contract: dict | None = None,
    schema: object = None,
    architecture: dict | None = None,
    drop_contract: bool = False,
    drop_architecture: bool = False,
    source_overrides: dict[str, str] | None = None,
    drop_sources: tuple[str, ...] = (),
) -> Path:
    """Copy the canonical contract set into a scratch repository and mutate it."""

    repo = tmp_path / "repo"
    arch_dir = repo / "architecture"
    arch_dir.mkdir(parents=True)

    if not drop_contract:
        document = contract if contract is not None else load_contract()
        (arch_dir / "lifecycle-contract.json").write_text(
            json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    schema_document = schema if schema is not None else load_schema()
    (arch_dir / "lifecycle-contract.schema.json").write_text(
        json.dumps(schema_document, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if not drop_architecture:
        architecture_document = architecture if architecture is not None else load_architecture()
        (arch_dir / "architecture-contract.json").write_text(
            json.dumps(architecture_document, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    (arch_dir / "architecture-contract.schema.json").write_text(
        ARCHITECTURE_SCHEMA_PATH.read_text(encoding="utf-8"), encoding="utf-8"
    )

    overrides = source_overrides or {}
    for source_file, _type_name in PINNED_SOURCE_BINDINGS.values():
        if source_file in drop_sources:
            continue
        destination = repo / source_file
        destination.parent.mkdir(parents=True, exist_ok=True)
        text = overrides.get(source_file)
        if text is None:
            text = (ROOT / source_file).read_text(encoding="utf-8")
        destination.write_text(text, encoding="utf-8")
    return repo


# --------------------------------------------------------------------------- #
# Canonical repository
# --------------------------------------------------------------------------- #


def test_canonical_repository_lifecycle_contracts_pass() -> None:
    result = check_lifecycle_contracts(ROOT)

    assert result.compared is True
    assert result.error_count == 0, [issue.to_dict() for issue in result.issues]
    # Unused evidence or any other warning on the canonical tree means the gate
    # is rotting quietly; the canonical repository must carry none.
    assert result.warning_count == 0, [issue.to_dict() for issue in result.issues]
    assert result.status == "passed"
    assert result.machine_count == len(PINNED_MACHINE_IDS)


def test_canonical_contract_matches_its_schema() -> None:
    assert validate_schema_instance(load_contract(), load_schema()) == []


def test_canonical_machines_states_and_declared_only_are_pinned() -> None:
    contract = load_contract()
    machines = {machine["id"]: machine for machine in contract["machines"]}
    assert set(machines) == set(PINNED_MACHINE_IDS)
    for machine_id, expected_states in PINNED_STATES.items():
        declared = {state["id"] for state in machines[machine_id]["states"]}
        assert declared == set(expected_states), machine_id
    declared_only = {
        (machine["id"], state["id"])
        for machine in contract["machines"]
        for state in machine["states"]
        if state.get("runtime_write_path") == "declared_only"
    }
    assert declared_only == set(PINNED_DECLARED_ONLY)


def test_canonical_forbidden_shortcuts_are_pinned() -> None:
    contract = load_contract()
    declared = {
        (machine["id"], shortcut["from"], shortcut["to"])
        for machine in contract["machines"]
        for shortcut in machine["forbidden_shortcuts"]
    }
    assert declared == set(PINNED_FORBIDDEN)


def test_canonical_source_bindings_are_pinned() -> None:
    contract = load_contract()
    declared = {
        machine["id"]: (machine["source_binding"]["file"], machine["source_binding"]["type_name"])
        for machine in contract["machines"]
    }
    assert declared == PINNED_SOURCE_BINDINGS


def test_canonical_evidence_gated_transitions_are_pinned() -> None:
    contract = load_contract()
    gated = {
        (machine["id"], transition["id"]): frozenset(transition["evidence_required"])
        for machine in contract["machines"]
        for transition in machine["transitions"]
        if transition["evidence_required"]
    }
    assert gated == PINNED_EVIDENCE_GATED_TRANSITIONS


def test_canonical_readiness_binding_matches_architecture_policy_and_pins() -> None:
    contract = load_contract()
    architecture = load_architecture()
    binding = contract["readiness_binding"]
    assert binding["policy_id"] == "review-session-ready"
    bound = {item["evidence_id"] for item in binding["evidence_bindings"]}
    assert bound == set(PINNED_READINESS_EVIDENCE)
    policy = next(
        policy
        for policy in architecture["readiness_policies"]
        if policy["id"] == "review-session-ready"
    )
    required = {item["id"] for item in policy["required_evidence"]}
    assert bound == required


def test_schema_files_keep_their_load_bearing_constraints() -> None:
    schema = load_schema()
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(PINNED_SCHEMA_TOP_REQUIRED)
    machine = schema["definitions"]["machine"]
    assert machine["additionalProperties"] is False
    assert set(machine["required"]) == set(PINNED_SCHEMA_MACHINE_REQUIRED)
    transition = schema["definitions"]["transition"]
    assert transition["additionalProperties"] is False
    assert set(transition["required"]) == set(PINNED_SCHEMA_TRANSITION_REQUIRED)
    assert tuple(schema["definitions"]["state"]["properties"]["kind"]["enum"]) == (
        PINNED_SCHEMA_STATE_KINDS
    )
    assert schema["properties"]["schema_version"]["const"] == CONTRACT_SCHEMA_VERSION


# --------------------------------------------------------------------------- #
# Model-based properties over the canonical contract
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def canonical_result():
    return check_lifecycle_contracts(ROOT)


def test_model_forbidden_pairs_have_no_single_step_edge(canonical_result) -> None:
    for machine in canonical_result.machines:
        edges = machine.edges()
        for pair in machine.forbidden_pairs:
            assert pair not in edges, (machine.id, pair)


def test_model_every_pending_to_active_path_crosses_the_evidence_gates(canonical_result) -> None:
    machine = model_by_id(canonical_result, "stage-binding")
    paths = machine.simple_paths("pending", "active")
    assert paths, "pending must be able to reach active through the declared transitions"
    for path in paths:
        visited = [transition.to_state for transition in path]
        assert "executing" in visited, [transition.id for transition in path]
        evidence = {
            evidence_id
            for transition in path
            for evidence_id in transition.evidence_required
        }
        assert evidence == {"attempt-binding-match", "runtime-load-outcome"}, (
            [transition.id for transition in path]
        )


def test_model_every_forbidden_pair_path_crosses_an_intermediate_state(canonical_result) -> None:
    """No multi-step bypass reaches a forbidden target without an intermediate.

    A forbidden shortcut bans the *single-step* edge; a longer path is legal
    exactly because it crosses the machine's intermediate evidence-carrying
    states. Enumerating every simple path proves there is no second direct
    route hiding in the model.
    """

    for machine in canonical_result.machines:
        kinds_intermediate = {
            state
            for state in machine.states
            if state not in machine.terminal_states and state not in machine.initial_states
        }
        for source, target in machine.forbidden_pairs:
            for path in machine.simple_paths(source, target):
                assert len(path) >= 2, (machine.id, source, target)
                crossed = {transition.to_state for transition in path[:-1]}
                assert crossed & kinds_intermediate, (machine.id, source, target, crossed)


def test_model_terminal_states_have_no_outgoing_transitions(canonical_result) -> None:
    for machine in canonical_result.machines:
        terminal = set(machine.terminal_states)
        for transition in machine.transitions:
            assert transition.from_state not in terminal, (machine.id, transition.id)


def test_model_all_states_reachable_or_declared_only(canonical_result) -> None:
    for machine in canonical_result.machines:
        reachable = machine.reachable_states()
        unreachable = set(machine.states) - reachable - set(machine.declared_only_states)
        assert not unreachable, (machine.id, unreachable)


def test_model_transitions_deterministic_per_from_and_trigger(canonical_result) -> None:
    for machine in canonical_result.machines:
        seen: dict[tuple[str, str], str] = {}
        for transition in machine.transitions:
            key = (transition.from_state, transition.trigger)
            assert key not in seen, (machine.id, transition.id, seen[key])
            seen[key] = transition.id


def test_model_lease_terminal_states_cannot_reach_active(canonical_result) -> None:
    machine = model_by_id(canonical_result, "endpoint-lease")
    for source in ("released", "expired"):
        assert machine.simple_paths(source, "active") == []


# --------------------------------------------------------------------------- #
# Fail-closed loading
# --------------------------------------------------------------------------- #


def test_missing_contract_file_fails_closed(tmp_path) -> None:
    repo = build_tmp_repo(tmp_path, drop_contract=True)
    result = check_lifecycle_contracts(repo)
    assert result.compared is False
    assert result.status == "failed"
    assert "file.read" in issue_codes(result)


def test_non_object_contract_fails_closed(tmp_path) -> None:
    repo = build_tmp_repo(tmp_path)
    (repo / "architecture" / "lifecycle-contract.json").write_text("null", encoding="utf-8")
    result = check_lifecycle_contracts(repo)
    assert result.compared is False
    assert result.status == "failed"
    assert "lifecycle_contract.not_object" in issue_codes(result)


def test_vacuous_schema_rejected(tmp_path) -> None:
    for index, stub in enumerate(({}, {"type": "object"}, {"properties": {}}, {"required": []})):
        repo = build_tmp_repo(tmp_path / f"case-{index}", schema=stub)
        result = check_lifecycle_contracts(repo)
        assert result.status == "failed", stub
        codes = issue_codes(result)
        assert "lifecycle_contract.schema_vacuous" in codes or (
            "lifecycle_contract.schema_not_object" in codes
        ), stub


def test_wrong_schema_version_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["schema_version"] = "ai-bim-lifecycle-contract/v0"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle_contract.schema_version" in issue_codes(result)


def test_missing_architecture_contract_fails_closed(tmp_path) -> None:
    repo = build_tmp_repo(tmp_path, drop_architecture=True)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    codes = issue_codes(result)
    assert "lifecycle.machine.owner_unverifiable" in codes
    assert "lifecycle.readiness.policy_unverifiable" in codes


# --------------------------------------------------------------------------- #
# Fail-closed machine semantics
# --------------------------------------------------------------------------- #


def test_unknown_transition_state_rejected(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "endpoint-lease")["transitions"][0]["to"] = "ghost"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.transition.unknown_state" in issue_codes(result)


def test_terminal_outgoing_transition_rejected(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "review-session")["transitions"].append(
        {
            "id": "reopen",
            "from": "closed",
            "to": "active",
            "trigger": "reopen-session",
            "evidence_required": [],
            "description": "Terminal escape used as a counterexample.",
        }
    )
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.terminal.outgoing" in issue_codes(result)


def test_forbidden_pair_with_direct_edge_contradiction_rejected(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "stage-binding")["transitions"].append(
        {
            "id": "shortcut",
            "from": "pending",
            "to": "active",
            "trigger": "shortcut-trigger",
            "evidence_required": [],
            "description": "Forbidden shortcut materialized as a counterexample.",
        }
    )
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.forbidden.direct_edge_exists" in issue_codes(result)


def test_unknown_evidence_reference_rejected(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "stage-binding")["transitions"][0]["evidence_required"] = [
        "no-such-evidence"
    ]
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.evidence.unknown" in issue_codes(result)


def test_unreachable_state_rejected(tmp_path) -> None:
    contract = load_contract()
    machine = machine_by_id(contract, "endpoint-lease")
    machine["states"].append(
        {
            "id": "orphaned",
            "kind": "intermediate",
            "description": "No transition reaches this state.",
        }
    )
    # Keep the source union untouched: the orphan also desynchronizes the
    # source binding, and both findings must appear.
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    codes = issue_codes(result)
    assert "lifecycle.state.unreachable" in codes
    assert "lifecycle.source_sync.state_missing_in_source" in codes


def test_declared_only_state_with_transition_rejected(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "review-session")["transitions"].append(
        {
            "id": "fail-session",
            "from": "active",
            "to": "failed",
            "trigger": "fail-session",
            "evidence_required": [],
            "description": "Wiring a declared_only state as a counterexample.",
        }
    )
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.state.declared_only_wired" in issue_codes(result)


def test_declared_only_initial_state_rejected(tmp_path) -> None:
    contract = load_contract()
    machine = machine_by_id(contract, "review-session")
    failed_state = next(state for state in machine["states"] if state["id"] == "failed")
    failed_state["kind"] = "initial"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.state.declared_only_initial" in issue_codes(result)


def test_duplicate_machine_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["machines"].append(deepcopy(contract["machines"][0]))
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.machine.duplicate" in issue_codes(result)


def test_duplicate_state_rejected(tmp_path) -> None:
    contract = load_contract()
    machine = machine_by_id(contract, "endpoint-lease")
    machine["states"].append(deepcopy(machine["states"][0]))
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.state.duplicate" in issue_codes(result)


def test_duplicate_transition_id_rejected(tmp_path) -> None:
    contract = load_contract()
    machine = machine_by_id(contract, "endpoint-lease")
    clone = deepcopy(machine["transitions"][0])
    clone["trigger"] = "another-trigger"
    machine["transitions"].append(clone)
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.transition.duplicate" in issue_codes(result)


def test_nondeterministic_transitions_rejected(tmp_path) -> None:
    contract = load_contract()
    machine = machine_by_id(contract, "endpoint-lease")
    machine["transitions"].append(
        {
            "id": "ttl-expire-elsewhere",
            "from": "active",
            "to": "released",
            "trigger": "ttl-sweep",
            "evidence_required": [],
            "description": "Same (from, trigger) with a different target as a counterexample.",
        }
    )
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.transition.nondeterministic" in issue_codes(result)


def test_forbidden_self_loop_rejected(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "endpoint-lease")["forbidden_shortcuts"].append(
        {
            "id": "self-loop",
            "from": "active",
            "to": "active",
            "reason": "Nonsense pair as a counterexample.",
            "enforced_by": "nothing",
        }
    )
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.forbidden.self_loop" in issue_codes(result)


def test_unknown_owner_service_rejected(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "endpoint-lease")["owner_service"] = "ghost-service"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.machine.unknown_service" in issue_codes(result)


# --------------------------------------------------------------------------- #
# Fail-closed cross-machine rules
# --------------------------------------------------------------------------- #


def test_cross_rule_unknown_machine_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["cross_machine_rules"][0]["machines"] = ["review-session", "ghost-machine"]
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.cross.unknown_machine" in issue_codes(result)


def test_cross_rule_unknown_required_state_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["cross_machine_rules"][0]["required_states"][0]["any_of"] = ["ghost-state"]
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.cross.unknown_state" in issue_codes(result)


def test_cascade_unknown_trigger_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["cross_machine_rules"][1]["cascade"]["on_trigger"] = "ghost-trigger"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.cross.unknown_trigger" in issue_codes(result)


def test_cascade_unknown_transition_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["cross_machine_rules"][1]["cascade"]["applies_transition"] = "ghost-transition"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.cross.unknown_transition" in issue_codes(result)


# --------------------------------------------------------------------------- #
# Fail-closed readiness binding
# --------------------------------------------------------------------------- #


def test_readiness_missing_required_evidence_rejected(tmp_path) -> None:
    contract = load_contract()
    bindings = contract["readiness_binding"]["evidence_bindings"]
    contract["readiness_binding"]["evidence_bindings"] = [
        item for item in bindings if item["evidence_id"] != "first-frame-at"
    ]
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.readiness.evidence_unbound" in issue_codes(result)


def test_readiness_extra_evidence_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["readiness_binding"]["evidence_bindings"].append(
        {
            "evidence_id": "extra-evidence",
            "provider": "kit-manager-api",
            "surface": "Invented evidence as a counterexample.",
        }
    )
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.readiness.evidence_undeclared" in issue_codes(result)


def test_readiness_unknown_policy_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["readiness_binding"]["policy_id"] = "ghost-policy"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.readiness.unknown_policy" in issue_codes(result)


def test_readiness_unknown_machine_evidence_rejected(tmp_path) -> None:
    contract = load_contract()
    binding = next(
        item
        for item in contract["readiness_binding"]["evidence_bindings"]
        if item["evidence_id"] == "first-frame-at"
    )
    assert binding["provider"] == "endpoint-lease"
    binding["evidence_id"] = "stage-matched-typo"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    codes = issue_codes(result)
    assert "lifecycle.readiness.unknown_machine_evidence" in codes


def test_readiness_unknown_provider_rejected(tmp_path) -> None:
    contract = load_contract()
    contract["readiness_binding"]["evidence_bindings"][0]["provider"] = "ghost-provider"
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.readiness.unknown_provider" in issue_codes(result)


def test_unused_evidence_warns_without_failing(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "stage-binding")["evidence"].append(
        {
            "id": "dangling-evidence",
            "description": "Declared but consumed by nothing.",
            "source": "nowhere",
        }
    )
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert "lifecycle.evidence.unused" in issue_codes(result)
    assert result.warning_count >= 1
    assert result.error_count == 0
    assert result.status == "passed"


# --------------------------------------------------------------------------- #
# Source synchronization
# --------------------------------------------------------------------------- #


def test_source_sync_state_missing_in_source_rejected(tmp_path) -> None:
    source_file, _ = PINNED_SOURCE_BINDINGS["review-session"]
    text = (ROOT / source_file).read_text(encoding="utf-8")
    assert '"closing" | "closed" | "failed";' in text
    mutated = text.replace('"closing" | "closed" | "failed";', '"closing" | "closed";', 1)
    repo = build_tmp_repo(tmp_path, source_overrides={source_file: mutated})
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.source_sync.state_missing_in_source" in issue_codes(result)


def test_source_sync_state_missing_in_contract_rejected(tmp_path) -> None:
    source_file, _ = PINNED_SOURCE_BINDINGS["review-session"]
    text = (ROOT / source_file).read_text(encoding="utf-8")
    mutated = text.replace('"failed";', '"failed" | "paused";', 1)
    assert mutated != text
    repo = build_tmp_repo(tmp_path, source_overrides={source_file: mutated})
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.source_sync.state_missing_in_contract" in issue_codes(result)


def test_source_sync_type_not_found_rejected(tmp_path) -> None:
    source_file, type_name = PINNED_SOURCE_BINDINGS["endpoint-lease"]
    text = (ROOT / source_file).read_text(encoding="utf-8")
    mutated = text.replace(f"export type {type_name} =", f"export type {type_name}Renamed =", 1)
    assert mutated != text
    repo = build_tmp_repo(tmp_path, source_overrides={source_file: mutated})
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.source_sync.union_unparsed" in issue_codes(result)


def test_source_sync_union_referencing_another_type_rejected(tmp_path) -> None:
    source_file, type_name = PINNED_SOURCE_BINDINGS["endpoint-lease"]
    text = (ROOT / source_file).read_text(encoding="utf-8")
    mutated = text.replace(
        f'export type {type_name} = "active"',
        f'export type {type_name} = SomeAlias | "active"',
        1,
    )
    assert mutated != text
    repo = build_tmp_repo(tmp_path, source_overrides={source_file: mutated})
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.source_sync.union_unparsed" in issue_codes(result)


def test_source_sync_missing_file_rejected(tmp_path) -> None:
    source_file, _ = PINNED_SOURCE_BINDINGS["stage-binding"]
    repo = build_tmp_repo(tmp_path, drop_sources=(source_file,))
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.source_sync.file_unreadable" in issue_codes(result)


def test_source_binding_path_escape_rejected(tmp_path) -> None:
    contract = load_contract()
    machine_by_id(contract, "review-session")["source_binding"]["file"] = (
        "bim-review-coordinator/../secrets.ts"
    )
    repo = build_tmp_repo(tmp_path, contract=contract)
    result = check_lifecycle_contracts(repo)
    assert result.status == "failed"
    assert "lifecycle.source_binding.path_escape" in issue_codes(result)


def test_extract_union_literals_behaviors() -> None:
    ok, reason = _extract_union_literals(
        'export type S = "a" | "b" | "c";', "S"
    )
    assert reason is None and ok == ["a", "b", "c"]

    multiline, reason = _extract_union_literals(
        'export type S =\n  | "a"\n  | "b";', "S"
    )
    assert reason is None and multiline == ["a", "b"]

    missing, reason = _extract_union_literals('export type T = "a";', "S")
    assert missing is None and reason == "type_not_found"

    aliased, reason = _extract_union_literals('export type S = Other | "a";', "S")
    assert aliased is None and reason == "unsupported_union"

    empty, reason = _extract_union_literals("export type S = ;", "S")
    assert empty is None and reason == "no_literals"

    duplicated, reason = _extract_union_literals('export type S = "a" | "a";', "S")
    assert duplicated is None and reason == "duplicate_literals"

    hollow, reason = _extract_union_literals('export type S = "" | "a";', "S")
    assert hollow is None and reason == "empty_literal"


# --------------------------------------------------------------------------- #
# Canonical runtime unions still match the pins directly
# --------------------------------------------------------------------------- #


def test_runtime_source_unions_match_pinned_states() -> None:
    """Reads the real TypeScript files, independently of the checker."""

    for machine_id, (source_file, type_name) in PINNED_SOURCE_BINDINGS.items():
        text = (ROOT / source_file).read_text(encoding="utf-8")
        literals, reason = _extract_union_literals(text, type_name)
        assert reason is None, (machine_id, reason)
        assert literals is not None
        assert set(literals) == set(PINNED_STATES[machine_id]), machine_id


# --------------------------------------------------------------------------- #
# Developer entry point
# --------------------------------------------------------------------------- #


def test_check_script_passes_on_canonical_repository() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "dev" / "check_lifecycle_contracts.py"),
            "--repo-root",
            str(ROOT),
            "--format",
            "json",
            "--strict",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["status"] == "passed"
    assert payload["compared"] is True
    assert payload["summary"]["machines"] == len(PINNED_MACHINE_IDS)
