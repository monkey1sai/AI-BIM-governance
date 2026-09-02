import copy
import importlib.metadata
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

assert importlib.metadata.version("jsonschema") == "4.26.0"

from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "agent-contracts" / "parallel-delivery-fabric.schema.json"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "agent-governance.yml"
ROOT_CI_PATH = ROOT / ".github" / "workflows" / "ci.yml"
NODE_CONTRACT_TEST_PATH = ROOT / "scripts" / "tests" / "parallel-delivery-fabric" / "test-contract.mjs"
CONTRACT_MODULE_PATH = ROOT / "scripts" / "lib" / "parallel-delivery-fabric-contract.mjs"
SHA1 = "a" * 40
SHA256 = "c" * 64
NOW = "2026-08-28T12:00:00.000Z"
LATER = "2026-08-28T13:00:00.000Z"
SEMANTIC_VALIDATION_CONTRACT = (
    "Contract acceptance requires Draft 2020 structural validation followed by "
    "validateFabricContract(definition, value) for semantic invariants that Draft 2020 cannot express."
)


FORMAT_CHECKER = FormatChecker()


@FORMAT_CHECKER.checks("date-time")
def is_canonical_utc_timestamp(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") == value


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def validator_for(definition: str) -> Draft202012Validator:
    schema = load_schema()
    document = {
        "$schema": schema["$schema"],
        "$defs": schema["$defs"],
        "$ref": f"#/$defs/{definition}",
    }
    Draft202012Validator.check_schema(document)
    return Draft202012Validator(document, format_checker=FORMAT_CHECKER)


def assert_accepted(definition: str, value: object) -> None:
    errors = list(validator_for(definition).iter_errors(value))
    assert not errors, f"{definition} unexpectedly rejected: {errors}"


def assert_rejected(definition: str, value: object) -> None:
    errors = list(validator_for(definition).iter_errors(value))
    assert errors, f"{definition} must reject {value!r}"


def plan() -> dict:
    return {
        "schema_version": "parallel-delivery-fabric/v1",
        "plan_id": "plan:contract",
        "generation": 1,
        "repo_identity": {
            "full_name": "acme/bim",
            "repository_id": 1,
            "common_dir_digest": SHA256,
        },
        "created_at": NOW,
        "coordinator_session": "session:coordinator",
        "baseline_ref": "origin/main",
        "resolved_baseline_sha": SHA1,
        "tasks": [
            {
                "task_id": "task:contract",
                "outcome": "closed-contract",
                "provider_preference": "codex",
                "owner_session": "session:writer",
                "scope": {
                    "owning_service": "delivery-fabric",
                    "public_entrypoint": "scripts/lib/parallel-delivery-fabric-contract.mjs",
                    "resources": [{"kind": "path", "path": "scripts/contracts/plan.json"}],
                    "expected_tests": ["test:contract"],
                    "e2e_required": False,
                },
                "dependencies": [],
                "risk": "bounded",
                "e2e_required": False,
            }
        ],
        "requested_capacity": {"writers": 1, "runtime_leases": 3},
        "branch_profile": "trunk",
        "acceptance_criteria": ["criterion:closed-schema"],
        "promotion_mode": "single_pr",
        "requested_execution_level": "plan_only",
        "authority_reference": "authority:plan",
        "governance_source_refs": ["openspec:parallel-delivery-fabric"],
    }


def candidate() -> dict:
    return {
        "schema_version": "candidate-envelope/v1",
        "candidate_id": "candidate:one",
        "task_id": "task:one",
        "branch": "codex/task-one",
        "pr_number": 1,
        "head_sha": SHA1,
        "base_ref": "origin/main",
        "base_sha": SHA1,
        "scope_digest": SHA256,
        "dependency_shas": [],
        "checks_digest": SHA256,
        "review_packet_digest": SHA256,
        "e2e_evidence_refs": ["evidence:one"],
        "generation": 1,
        "created_at": NOW,
        "invalidated_at": None,
        "invalidation_reason": None,
    }


def managed_branch() -> dict:
    return {
        "schema_version": "managed-branch/v1",
        "branch": "develop",
        "branch_class": "develop",
        "owner_authority": "authority:managed-base",
        "protection_profile_digest": SHA256,
        "base_ref": "origin/main",
        "base_sha": SHA1,
        "generation": 1,
        "scope_digest": SHA256,
        "allowed_merge_targets": ["origin/main"],
        "created_at": NOW,
        "renewed_at": NOW,
        "expires_at": LATER,
        "current_head_sha": SHA1,
        "registry_oid": SHA1,
        "managed_base_lease_id": "lease:managed-base",
        "transition_sequence": 0,
        "state": "ACTIVE",
        "canonical_digest": SHA256,
    }


def execution_envelope() -> dict:
    return {
        "schema_version": "execution-envelope/v1",
        "envelope_id": "envelope:one",
        "plan_id": "plan:contract",
        "generation": 1,
        "task_id": "task:contract",
        "owner_session": "session:writer",
        "provider": "codex",
        "provider_session_id": "provider-session:one",
        "execution_context_id": "execution-context:one",
        "context_attestation_digest": SHA256,
        "issuer_id": "issuer:control-plane",
        "issuer_version": "fabric-control-plane/v1",
        "authority_reference": "authority:plan",
        "authority_digest": SHA256,
        "issued_at": NOW,
        "expires_at": LATER,
        "revocation_epoch": 0,
        "command_nonce": "n" * 32,
        "authorized_highest_level": "submit_delivery",
        "current_level": "plan_only",
        "transition_sequence": 0,
        "expected_previous_envelope_oid": "0" * 40,
        "expected_lease_registry_oid": "0" * 40,
        "repo_identity_digest": SHA256,
        "common_dir_digest": SHA256,
        "worktree_id": None,
        "worktree_path_digest": None,
        "branch": None,
        "baseline_sha": SHA1,
        "head_sha": None,
        "scope_digest": SHA256,
        "lease_id": None,
        "allowed_remote": "origin",
        "allowed_repository": "acme/bim",
        "allowed_base": "origin/main",
        "expected_remote_ref": None,
        "expected_remote_sha": None,
        "promotion_mode": "single_pr",
        "external_capability_reference": None,
        "side_effect_class": "CONTROL_METADATA",
    }


def implementation_execution_envelope() -> dict:
    value = execution_envelope()
    value["current_level"] = "implement_local"
    value["transition_sequence"] = 1
    return value


def stack() -> dict:
    return {
        "schema_version": "stack-delivery-envelope/v1",
        "stack_id": "stack:one",
        "trunk_ref": "origin/main",
        "trunk_sha": SHA1,
        "selected_top_pr": 42,
        "ordered_member_vector_digest": SHA256,
        "merge_action": "direct_merge",
        "merge_method": "merge",
        "members": [
            {
                "pr_number": 42,
                "node_id": "node:pr-42",
                "position": 1,
                "head_ref": "codex/task-contract",
                "head_sha": SHA1,
                "direct_base_ref": "origin/main",
                "direct_base_sha": SHA1,
                "exact_head_packet_digest": SHA256,
                "checks_digest": SHA256,
                "independent_review_digest": SHA256,
                "e2e_required": False,
                "e2e_result_digest": None,
                "unresolved_finding_state": "none",
            }
        ],
        "expected_protection_digest": SHA256,
        "capability_reference": "capability:stack-v1",
        "deployment_target_reference": "target:canonical-test",
        "created_at": NOW,
        "expires_at": LATER,
    }


def e2e_manifest() -> dict:
    return {
        "schema_version": "e2e-manifest/v1",
        "manifest_id": "manifest:" + SHA256[:40],
        "candidate_head_sha": SHA1,
        "applicability_record_digest": SHA256,
        "manifest_digest": SHA256,
        "stack_kind": "isolated_branch_stack",
        "head_sha": SHA1,
        "tree_digest": SHA256,
        "manifest_path_digest": SHA256,
        "manifest_sha256": SHA256,
        "manifest_sha256_at_start": SHA256,
        "manifest_sha256_at_publication": SHA256,
        "execution_window": {"started_at": NOW, "finished_at": LATER},
        "offset": 0,
        "ports": {"coordinator": 8005, "governance": 49103, "viewer": 5180},
        "base_urls": {
            "coordinator": "http://127.0.0.1:8005",
            "governance": "http://127.0.0.1:49103",
            "viewer": "http://127.0.0.1:5180",
        },
        "branch": "codex/task-contract",
        "worktree_id": "worktree:contract",
        "worktree_path_digest": SHA256,
        "route": "#conv",
        "main_buttons": ["Upload IFC"],
        "fixture_reference": "fixture:ifc-ready",
        "api_reference": "api:ifc-ready",
        "runtime_reference": "runtime:conversion-1",
        "visible_state": "state:success",
        "network_digest": SHA256,
        "trace_sha256": SHA256,
        "screenshot_sha256": SHA256,
        "trace_reference": "trace:" + SHA256[:40],
        "screenshot_reference": "screenshot:" + SHA256[:40],
        "command_records_digest": SHA256,
        "runtime_identity_digest": SHA256,
        "runtime_lineage_digest": SHA256,
        "listener_digest": SHA256,
        "reserved_port_guard": "clean",
        "trusted_verifier_sha": SHA256,
        "trusted_binder_sha": SHA256,
        "verifier_tree_digest": SHA256,
        "harness_digest": SHA256,
        "computer_use_authority_digest": SHA256,
        "verification_mode": "canonical",
        "candidate_harness_status": "unchanged",
        "created_at": NOW,
    }


def synthetic_binder_evidence() -> dict:
    """Exercise the pure binder with synthetic packets; this is not real E2E evidence."""
    script = r'''
import { bindBrowserEvidence } from './scripts/lib/parallel-delivery-fabric-e2e-binder.mjs'
import { digestCanonical } from './scripts/lib/parallel-delivery-fabric-contract.mjs'

const sha1 = character => character.repeat(40)
const sha256 = character => character.repeat(64)
const base = sha1('a')
const head = sha1('b')
const tree = sha256('d')
const manifestDigest = sha256('e')
const runtime = sha256('f')
const path = sha256('1')
const trusted = sha256('2')
const binder = sha256('3')
const trace = sha256('4')
const screenshot = sha256('5')
const listenerDigest = sha256('b')
const policySourceSha = sha1('8')
const authorityDigest = sha256('a')
const now = '2026-08-29T01:00:00.000Z'
const later = '2026-08-29T02:00:00.000Z'
const ports = { coordinator: 8005, governance: 49103, viewer: 5180 }
const baseUrls = {
  coordinator: 'http://127.0.0.1:8005',
  governance: 'http://127.0.0.1:49103',
  viewer: 'http://127.0.0.1:5180',
}
const applicabilityPayload = {
  schema_version: 'e2e-applicability/v1',
  source: 'base',
  source_ref: 'ref:e2e-policy',
  source_sha: policySourceSha,
  base_sha: base,
  policy_digest: sha256('9'),
  e2e_required: true,
  immutable: true,
  base_pinned: true,
  fresh: true,
}
const applicability = { ...applicabilityPayload, record_digest: digestCanonical(applicabilityPayload) }
const candidate = {
  candidate_id: 'candidate:one', head_sha: head, tree_digest: tree,
  branch: 'codex/task-one', worktree_id: 'worktree:one', worktree_path_digest: path,
  manifest_sha256: manifestDigest, manifest_path_digest: sha256('a'), runtime_identity_digest: runtime,
  base_sha: base, owner_session: 'writer:candidate', applicability, harness_modified: false,
}
const manifest = {
  schema_version: 'isolated-branch-stack/v1', stack_kind: 'isolated_branch_stack', head_sha: head,
  manifest_sha256: manifestDigest, manifest_sha256_at_start: manifestDigest,
  manifest_sha256_at_publication: manifestDigest, manifest_path_digest: sha256('a'),
  offset: 0, ports, base_urls: baseUrls, branch: candidate.branch, worktree_id: candidate.worktree_id,
  worktree_path_digest: path, tree_digest: tree, runtime_identity_digest: runtime,
  execution_window: { started_at: now, finished_at: later }, started_at: now,
}
const lifecycle = { git_preflight: [0, 5], stack_start: [5, 10], stack_status: [10, 12], playwright_require_real: [12, 30], computer_use: [12, 35], postflight: [35, 40] }
const minutesAfter = minutes => new Date(Date.parse(now) + minutes * 60000).toISOString()
const commandPins = Object.fromEntries(Object.keys(lifecycle).map(role => [role, { cwd_digest: sha256('c'), argv_digest: sha256('d'), environment_contract: 'e2e-require-real/v1' }]))
const trustedPins = {
  source: 'prior-trusted', source_ref: applicability.source_ref, source_sha: policySourceSha, base_sha: base,
  policy_digest: applicability.policy_digest, applicability_record_digest: applicability.record_digest,
  immutable: true, base_pinned: true, fresh: true, verifier_sha: trusted, binder_sha: binder,
  verifier_tree_digest: trusted, harness_digest: trusted, authority_digest: null, command_pins: commandPins,
  expected_flow: { route: '#conv', main_buttons: ['Upload IFC'], fixture: 'fixture:ifc-ready', api: 'api:ifc-ready', runtime_id: 'runtime:conversion-1', visible_state: 'state:success' },
}
trustedPins.authority_digest = digestCanonical({
  source_ref: trustedPins.source_ref, source_sha: trustedPins.source_sha, base_sha: trustedPins.base_sha,
  verifier_tree_digest: trustedPins.verifier_tree_digest, harness_digest: trustedPins.harness_digest,
  command_pins: trustedPins.command_pins, expected_flow: trustedPins.expected_flow,
})
const authority = {
  schema_version: 'computer-use-authority/v1', source: 'prior-trusted', source_ref: applicability.source_ref,
  source_sha: policySourceSha, base_sha: base, authority_digest: trustedPins.authority_digest,
  verifier_identity: 'computer-use:one', immutable: true, base_pinned: true, fresh: true, read_only: true,
  can_edit: false, can_push: false, can_resolve: false, can_publish_required_check: false,
  can_approve: false, can_merge: false, can_deploy: false,
}
const commandRecords = Object.entries(lifecycle)
  .map(([role, [start, finish]]) => ({
    role, cwd_digest: sha256('c'), argv_digest: sha256('d'), safe_environment_contract: 'e2e-require-real/v1',
    started_at: minutesAfter(start), finished_at: minutesAfter(finish), exit_code: 0, stdout_artifact_ref: 'artifact:stdout',
    stderr_artifact_ref: 'artifact:stderr', redaction_status: 'sanitized',
  }))
const commandsDigest = digestCanonical(commandRecords)
const packet = role => ({
  verifier_role: role, verifier_identity: role === 'computer_use' ? 'computer-use:one' : 'playwright:canonical',
  status: 'passed', e2e_require_real: '1', skipped: false, manifest_present: true, timed_out: false,
  manifest_path_digest: manifest.manifest_path_digest, manifest_sha256: manifestDigest,
  manifest_sha256_at_start: manifestDigest, manifest_sha256_at_publication: manifestDigest,
  stack_kind: 'isolated_branch_stack', head_sha: head, tree_digest: tree, runtime_identity_digest: runtime,
  branch: candidate.branch, worktree_id: candidate.worktree_id, worktree_path_digest: path, offset: 0, ports, base_urls: baseUrls,
  trusted_verifier_sha: trusted, trusted_binder_sha: binder, verifier_tree_digest: trusted, harness_digest: trusted,
  candidate_harness_status: 'unchanged', verification_mode: 'canonical', reserved_port_guard: 'clean', listener_digest: listenerDigest,
  route: '#conv', main_buttons: ['Upload IFC'], fixture: 'fixture:ifc-ready', api: 'api:ifc-ready',
  runtime_id: 'runtime:conversion-1', visible_state: 'state:success', network_result: 'network:ok',
  trace_sha256: trace, screenshot_sha256: screenshot, command_records_digest: commandsDigest,
  runtime_lineage_digest: runtime, command_records: commandRecords, execution_window: { started_at: now, finished_at: later },
  ...(role === 'computer_use' ? { authority } : {}),
})
const result = bindBrowserEvidence({
  candidate, manifest, playwright: packet('playwright'), computerUse: packet('computer_use'), trustedPins,
})
if (result.status !== 'READY_FOR_TRAIN') throw new Error(`unexpected synthetic binder status: ${result.status}`)
process.stdout.write(JSON.stringify(result.evidence))
'''
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def semantic_differential_cases() -> dict[str, tuple[str, dict]]:
    duplicate_task = plan()
    duplicate_task["tasks"].append(copy.deepcopy(duplicate_task["tasks"][0]))

    duplicate_normalized_resource = plan()
    duplicate_normalized_resource["tasks"][0]["scope"]["resources"] = [
        {"kind": "path", "path": "src/caf\u00e9.mjs"},
        {"kind": "path", "path": "src/cafe\u0301.mjs"},
    ]

    e2e_mismatch = plan()
    e2e_mismatch["tasks"][0]["e2e_required"] = True

    self_issued = execution_envelope()
    self_issued["issuer_id"] = self_issued["owner_session"]

    untyped_owner = execution_envelope()
    untyped_owner["owner_session"] = "writer-session"

    stack_e2e_mismatch = stack()
    stack_e2e_mismatch["members"][0]["e2e_required"] = True

    selected_top_not_final = stack()
    final_member = copy.deepcopy(selected_top_not_final["members"][0])
    final_member.update(pr_number=43, position=2)
    selected_top_not_final["members"].append(final_member)

    return {
        "duplicate_task_id": ("plan", duplicate_task),
        "duplicate_normalized_scope_resource": ("plan", duplicate_normalized_resource),
        "task_scope_e2e_required_mismatch": ("plan", e2e_mismatch),
        "self_issued_execution_envelope": ("execution_envelope", self_issued),
        "execution_owner_session_without_namespace": ("execution_envelope", untyped_owner),
        "stack_e2e_required_result_digest_mismatch": ("stack", stack_e2e_mismatch),
        "stack_selected_top_pr_not_final_member": ("stack", selected_top_not_final),
    }


def test_schema_uses_the_existing_hash_pinned_jsonschema_job() -> None:
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
    assert "jsonschema==4.26.0 --hash=sha256:d489f15263b8d200f8387e64b4c3a75f06629559fb73deb8fdfb525f2dab50ce" in workflow
    root_ci = ROOT_CI_PATH.read_text(encoding="utf-8")
    root_contracts = root_ci.split("\n  root-contracts:", 1)[1].split("\n  coordinator:", 1)[0]
    assert "root-contracts-requirements.txt" in root_contracts
    assert "jsonschema==4.26.0 --hash=sha256:d489f15263b8d200f8387e64b4c3a75f06629559fb73deb8fdfb525f2dab50ce" in root_contracts
    assert "--only-binary=:all: --require-hashes" in root_contracts
    assert "python -m pip install --upgrade pip" not in root_contracts
    assert "python -m pip install pytest jsonschema==4.26.0" not in root_contracts


def test_node_contract_test_stays_parser_only_without_python_or_process_dependency() -> None:
    source = NODE_CONTRACT_TEST_PATH.read_text(encoding="utf-8")
    assert "node:child_process" not in source
    assert "execFileSync" not in source
    assert "DRAFT_2020_VALIDATOR" not in source
    assert "REPO_LOCAL_DRAFT_2020_PYTHON" not in source


def test_draft_2020_schema_is_well_formed_and_accepts_positive_fixtures() -> None:
    Draft202012Validator.check_schema(load_schema())
    assert_accepted("plan", plan())
    assert_accepted("candidate", candidate())
    assert_accepted("managed_branch", managed_branch())
    assert_accepted("execution_envelope", execution_envelope())
    assert_accepted("path_resource", {"kind": "path", "path": "scripts/contracts/plan.json"})


def test_e2e_manifest_schema_accepts_the_closed_binder_evidence_shape_and_rejects_each_omission() -> None:
    schema = load_schema()
    value = e2e_manifest()
    definition = schema["$defs"]["e2e_manifest"]
    assert set(value) == set(definition["required"]) == set(definition["properties"])
    assert_accepted("e2e_manifest", value)

    for field in definition["required"]:
        omitted = copy.deepcopy(value)
        del omitted[field]
        assert_rejected("e2e_manifest", omitted)

    unknown = copy.deepcopy(value)
    unknown["unexpected"] = True
    assert_rejected("e2e_manifest", unknown)


def test_e2e_manifest_schema_directly_accepts_synthetic_binder_evidence() -> None:
    evidence = synthetic_binder_evidence()
    definition = load_schema()["$defs"]["e2e_manifest"]
    assert set(evidence) == set(definition["required"]) == set(definition["properties"])
    assert_accepted("e2e_manifest", evidence)

    for field in definition["required"]:
        omitted = copy.deepcopy(evidence)
        del omitted[field]
        assert_rejected("e2e_manifest", omitted)


def test_draft_schema_closes_representable_differentials_and_leaves_only_documented_semantic_cases() -> None:
    accepted = {
        name
        for name, (definition, fixture) in semantic_differential_cases().items()
        if validator_for(definition).is_valid(fixture)
    }
    assert accepted == {
        "duplicate_task_id",
        "duplicate_normalized_scope_resource",
        "self_issued_execution_envelope",
        "stack_selected_top_pr_not_final_member",
    }


def test_schema_documents_the_required_semantic_validation_entrypoint() -> None:
    assert load_schema().get("$comment") == SEMANTIC_VALIDATION_CONTRACT
    assert "export function validateFabricContract" in CONTRACT_MODULE_PATH.read_text(encoding="utf-8")


def test_schema_rejects_unsafe_path_timestamp_unknown_and_additional_properties() -> None:
    for invalid_path in ("scripts/*.mjs", "scripts/./contract.mjs", "../secret.txt", "C:\\Users\\IOT\\secret.txt"):
        assert_rejected("path_resource", {"kind": "path", "path": invalid_path})

    invalid_timestamp = plan()
    invalid_timestamp["created_at"] = "2026-99-99T12:00:00.000Z"
    assert_rejected("plan", invalid_timestamp)

    missing_milliseconds = plan()
    missing_milliseconds["created_at"] = "2026-08-28T12:00:00Z"
    assert_rejected("plan", missing_milliseconds)

    unknown = plan()
    unknown["unexpected"] = True
    assert_rejected("plan", unknown)
    assert_rejected("path_resource", {"kind": "path", "path": "scripts/contract.mjs", "unexpected": True})


def test_schema_enforces_plan_only_and_adjacent_transition_rules() -> None:
    plan_only_binding = execution_envelope()
    plan_only_binding["branch"] = "codex/task-contract"
    assert_rejected("execution_envelope", plan_only_binding)

    non_adjacent_transition = execution_envelope()
    non_adjacent_transition["current_level"] = "submit_delivery"
    non_adjacent_transition["transition_sequence"] = 0
    assert_rejected("execution_envelope", non_adjacent_transition)


def test_managed_branch_schema_requires_registry_cas_and_lease_transition_bindings() -> None:
    for field in ("registry_oid", "managed_base_lease_id", "transition_sequence"):
        missing = managed_branch()
        del missing[field]
        assert_rejected("managed_branch", missing)

    for field, value in (
        ("registry_oid", "not-a-sha"),
        ("managed_base_lease_id", "lease without namespace"),
        ("transition_sequence", -1),
    ):
        hostile = managed_branch()
        hostile[field] = value
        assert_rejected("managed_branch", hostile)


def test_draft_schema_requires_namespaced_stack_durable_references() -> None:
    fixtures = []

    untyped_stack = stack()
    untyped_stack["stack_id"] = "stack-one"
    fixtures.append(untyped_stack)

    untyped_member = stack()
    untyped_member["members"][0]["node_id"] = "node-one"
    fixtures.append(untyped_member)

    untyped_capability = stack()
    untyped_capability["capability_reference"] = "capability-one"
    fixtures.append(untyped_capability)

    untyped_target = stack()
    untyped_target["deployment_target_reference"] = "target-one"
    fixtures.append(untyped_target)

    for hostile in fixtures:
        assert_rejected("stack", hostile)


def test_nullable_execution_references_reject_raw_sid_pid_and_namespaced_token() -> None:
    for field, value in (
        ("worktree_id", "S-1-5-21-4242"),
        ("lease_id", "4242"),
        ("external_capability_reference", "capability:ghp_abcdefghijklmno"),
    ):
        hostile = implementation_execution_envelope()
        hostile[field] = value
        assert_rejected("execution_envelope", hostile)


def test_candidate_rejects_namespaced_secret_in_every_legal_string_slot() -> None:
    for field, value in (
        ("candidate_id", "candidate:ghp_abcdefghijklmno"),
        ("task_id", "task:github_pat_abcdefghijklmno"),
        ("branch", "codex/authorization-marker"),
        ("base_ref", "origin/token-marker"),
        ("e2e_evidence_refs", ["evidence:private-key-marker"]),
        ("invalidation_reason", "authority:ghp_abcdefghijklmno"),
    ):
        hostile = copy.deepcopy(candidate())
        hostile[field] = value
        assert_rejected("candidate", hostile)


def fragment_validator(fragment: dict) -> Draft202012Validator:
    schema = load_schema()
    document = {"$schema": schema["$schema"], "$defs": schema["$defs"], **copy.deepcopy(fragment)}
    Draft202012Validator.check_schema(document)
    return Draft202012Validator(document, format_checker=FORMAT_CHECKER)


def resolve_local_ref(schema: dict, reference: str) -> dict:
    assert reference.startswith("#/")
    resolved: object = schema
    for segment in reference.removeprefix("#/").split("/"):
        assert isinstance(resolved, dict)
        resolved = resolved[segment]
    assert isinstance(resolved, dict)
    return resolved


def schema_can_accept_user_string(schema: dict, fragment: dict, seen_refs: frozenset[str] = frozenset()) -> bool:
    if "const" in fragment or "enum" in fragment:
        return False
    reference = fragment.get("$ref")
    if isinstance(reference, str):
        if reference in seen_refs:
            return False
        return schema_can_accept_user_string(schema, resolve_local_ref(schema, reference), seen_refs | {reference})
    value_type = fragment.get("type")
    if value_type == "string" or (isinstance(value_type, list) and "string" in value_type):
        return True
    for keyword in ("allOf", "anyOf", "oneOf"):
        branches = fragment.get(keyword, [])
        if any(schema_can_accept_user_string(schema, branch, seen_refs) for branch in branches):
            return True
    return False


def reachable_property_and_item_slots(schema: dict, fragment: dict, pointer: str, seen_refs: frozenset[str] = frozenset()):
    reference = fragment.get("$ref")
    if isinstance(reference, str) and reference not in seen_refs:
        yield from reachable_property_and_item_slots(
            schema,
            resolve_local_ref(schema, reference),
            f"{pointer}->{reference}",
            seen_refs | {reference},
        )
    for name, child in fragment.get("properties", {}).items():
        yield f"{pointer}/properties/{name}", child
        yield from reachable_property_and_item_slots(schema, child, f"{pointer}/properties/{name}", seen_refs)
    items = fragment.get("items")
    if isinstance(items, dict):
        yield f"{pointer}/items", items
        yield from reachable_property_and_item_slots(schema, items, f"{pointer}/items", seen_refs)
    for keyword in ("allOf", "anyOf", "oneOf"):
        for index, child in enumerate(fragment.get(keyword, [])):
            yield from reachable_property_and_item_slots(schema, child, f"{pointer}/{keyword}/{index}", seen_refs)


SECRET_MARKERS = ("bearer", "token-marker", "cookie-marker", "authorization-marker", "private-key-marker", "eyJabcdefghijklmno")


def secret_marker_values(reference: str) -> tuple[str, ...]:
    if reference in {"#/$defs/repository_path", "#/$defs/repository_glob"}:
        return tuple(f"src/{marker}.mjs" for marker in SECRET_MARKERS)
    if reference == "#/$defs/repository_full_name":
        return tuple(f"{marker}-owner/repository" for marker in SECRET_MARKERS)
    if reference == "#/$defs/route":
        return tuple(f"/{marker}" for marker in SECRET_MARKERS)
    if reference == "#/$defs/nonce":
        return tuple((marker + "a" * 32)[:32] for marker in SECRET_MARKERS)
    if reference in {"#/$defs/opaque_reference", "#/$defs/nullable_opaque_reference", "#/$defs/resource_key"}:
        return tuple(f"authority:{marker}" for marker in SECRET_MARKERS)
    return SECRET_MARKERS


def test_p1_1_schema_rejects_namespaced_raw_identity_without_rejecting_numeric_path_segments() -> None:
    for definition, value in (
        ("opaque_id", "authority:s-1-5-21-4242"),
        ("opaque_reference", "session:4242"),
        ("resource_key", "contract:s-1-5-21-4242"),
        ("resource_key", "contract:4242"),
    ):
        assert_rejected(definition, value)

    for field, value in (
        ("worktree_id", "worktree:s-1-5-21-4242"),
        ("lease_id", "lease:4242"),
        ("external_capability_reference", "capability:s-1-5-21-4242"),
    ):
        hostile = implementation_execution_envelope()
        hostile[field] = value
        assert_rejected("execution_envelope", hostile)

    assert_accepted("opaque_id", "path:src/2026/plan")
    assert_accepted("resource_key", "contract:src/2026/plan")


def test_p1_2_meta_every_reachable_string_slot_has_one_secret_safe_reference_and_rejects_markers() -> None:
    schema = load_schema()
    expected_secret_safe_references = {
        "#/$defs/secret_safe_string",
        "#/$defs/opaque_identity_safe_string",
        "#/$defs/opaque_id",
        "#/$defs/opaque_reference",
        "#/$defs/nullable_opaque_id",
        "#/$defs/nullable_opaque_reference",
        "#/$defs/nullable_secret_safe_string",
        "#/$defs/repository_path",
        "#/$defs/repository_glob",
        "#/$defs/repository_full_name",
        "#/$defs/nonce",
        "#/$defs/route",
        "#/$defs/resource_key",
        "#/$defs/sha1",
        "#/$defs/sha256",
        "#/$defs/timestamp",
        "#/$defs/nullable_sha1",
        "#/$defs/nullable_sha256",
        "#/$defs/nullable_timestamp",
    }
    slots = []
    for definition, fragment in schema["$defs"].items():
        slots.extend(reachable_property_and_item_slots(schema, fragment, f"#/$defs/{definition}"))

    checked = 0
    for pointer, fragment in slots:
        if not schema_can_accept_user_string(schema, fragment):
            continue
        reference = fragment.get("$ref")
        assert reference in expected_secret_safe_references, f"{pointer} is an uncentralized string slot"
        checked += 1
        validator = fragment_validator(fragment)
        for marker in secret_marker_values(reference):
            assert not validator.is_valid(marker), f"{pointer} accepted secret-shaped {marker!r}"
    assert checked > 0


def test_p1_3_external_terminal_pairs_are_closed() -> None:
    valid_pairs = {
        "DELIVERED": {"DELIVERY_VERIFIED"},
        "FAILED": {"MERGED_NOT_DELIVERED"},
        "HELD": {
            "MERGE_OUTCOME_UNVERIFIED",
            "PREMERGE_EVIDENCE_INVALID",
            "PREMERGE_AUTHORITY_UNAVAILABLE",
            "POLICY_OR_SETTINGS_DRIFT",
        },
    }
    all_reasons = set().union(*valid_pairs.values())
    for terminal_class, reasons in valid_pairs.items():
        for reason_code in reasons:
            assert_accepted("external_terminal", {
                "phase": "CLOSED",
                "terminal_class": terminal_class,
                "reason_code": reason_code,
            })
        for reason_code in all_reasons - reasons:
            assert_rejected("external_terminal", {
                "phase": "CLOSED",
                "terminal_class": terminal_class,
                "reason_code": reason_code,
            })

    for value in (
        {"phase": "OPEN", "terminal_class": "DELIVERED", "reason_code": "DELIVERY_VERIFIED"},
        {"phase": "CLOSED", "terminal_class": "DELIVERED", "reason_code": "DELIVERY_VERIFIED", "extra": True},
        {"phase": "CLOSED", "terminal_class": "STACK_DELIVERY_FAILED", "reason_code": "MERGED_NOT_DELIVERED"},
        {"phase": "CLOSED", "terminal_class": "STACK_DELIVERY_VERIFIED", "reason_code": "DELIVERY_VERIFIED"},
        {"phase": "CLOSED", "terminal_class": "STACK_UNKNOWN", "reason_code": "MERGE_OUTCOME_UNVERIFIED"},
        {"phase": "CLOSED", "terminal_class": "FAILED", "reason_code": "DEPLOYMENT_BLOCKED"},
        {"phase": "CLOSED", "terminal_class": "HELD", "reason_code": "ACTIVATION_UNATTESTED"},
        {"phase": "CLOSED", "terminal_class": "HELD", "reason_code": "DELIVERY_PENDING_FIXPOINT"},
        {"phase": "CLOSED", "terminal_class": "HELD", "reason_code": "STACK_DELIVERY_VERIFIED"},
        {"phase": "CLOSED", "terminal_class": "HELD", "reason_code": "MERGE_ASYNC_DISPATCHED"},
        {"phase": "CLOSED", "terminal_class": "HELD", "reason_code": "PENDING"},
        {"phase": "CLOSED", "terminal_class": "HELD", "reason_code": "TIMEOUT"},
    ):
        assert_rejected("external_terminal", value)


def test_secret_safe_string_rejects_bare_bearer_without_rejecting_near_words() -> None:
    assert_rejected("secret_safe_string", "authority:bearer")
    assert_accepted("secret_safe_string", "authority:bearing")
