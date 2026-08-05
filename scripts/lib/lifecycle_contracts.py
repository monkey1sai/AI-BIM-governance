"""Executable lifecycle contracts (Phase 4 of the architecture contract).

Phases 1-3 made the desired service topology, the observed dependency graph,
and the intra-service layer boundaries machine-checkable. This module does the
same for the three coordinator-owned runtime state machines: review-session,
endpoint-lease, and stage-binding.

The gate proves exactly three things and claims nothing beyond them:

1. ``architecture/lifecycle-contract.json`` describes well-formed machines:
   every state is reachable from an initial state, terminal states have no
   outgoing edges, forbidden shortcuts have no direct edge, transitions are
   deterministic per (from, trigger), and every evidence reference resolves.
2. The declared state set of each machine is exactly the literal union of the
   TypeScript type that owns it (``source_binding``). Editing either side alone
   fails the gate, so the contract cannot drift from the code silently.
3. The readiness binding names the same evidence set as the architecture
   contract's ``review-session-ready`` policy, so the two documents cannot
   diverge about what "ready" means.

Transition *behavior* is enforced by each service's own runtime and tests;
this gate never executes the runtime. Kit-side stage loading states are an
observed surface recorded in the contract's notes, not a gated machine.

Fail-closed posture, mirroring Phases 2-3: a run that could not load and
compare the contract must never report ``passed``. Missing or corrupt files,
vacuous schemas, an unresolvable source binding, a union the parser does not
understand -- all of these are findings, not silent successes.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Iterable, Mapping, TypeGuard

from scripts.lib.architecture_contract import (
    ValidationIssue,
    _is_mapping,
    _is_sequence,
    _issue,
)
from scripts.lib.layered_architecture import _load_document

CONTRACT_SCHEMA_VERSION = "ai-bim-lifecycle-contract/v1"
ARCHITECTURE_CONTRACT_SCHEMA_VERSION = "ai-bim-architecture-contract/v1"

CONTRACT_RELATIVE_PATH = "architecture/lifecycle-contract.json"
CONTRACT_SCHEMA_RELATIVE_PATH = "architecture/lifecycle-contract.schema.json"
ARCHITECTURE_CONTRACT_RELATIVE_PATH = "architecture/architecture-contract.json"
ARCHITECTURE_CONTRACT_SCHEMA_RELATIVE_PATH = "architecture/architecture-contract.schema.json"

STATE_KINDS = ("initial", "intermediate", "terminal")


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class TransitionModel:
    """One declared transition, reduced to the fields the model checks need."""

    id: str
    from_state: str
    to_state: str
    trigger: str
    evidence_required: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "from": self.from_state,
            "to": self.to_state,
            "trigger": self.trigger,
            "evidence_required": list(self.evidence_required),
        }


@dataclass(frozen=True, slots=True)
class MachineModel:
    """One declared machine, reduced to the fields the model checks need."""

    id: str
    owner_service: str
    source_file: str
    source_type_name: str
    states: tuple[str, ...]
    initial_states: tuple[str, ...]
    terminal_states: tuple[str, ...]
    declared_only_states: tuple[str, ...]
    transitions: tuple[TransitionModel, ...]
    forbidden_pairs: tuple[tuple[str, str], ...]
    evidence_ids: tuple[str, ...]

    def edges(self) -> set[tuple[str, str]]:
        return {(item.from_state, item.to_state) for item in self.transitions}

    def reachable_states(self) -> set[str]:
        """States reachable from the initial set by declared transitions."""

        adjacency: dict[str, set[str]] = {}
        for item in self.transitions:
            adjacency.setdefault(item.from_state, set()).add(item.to_state)
        seen = set(self.initial_states)
        frontier = list(self.initial_states)
        while frontier:
            current = frontier.pop()
            for target in adjacency.get(current, ()):
                if target not in seen:
                    seen.add(target)
                    frontier.append(target)
        return seen

    def simple_paths(self, source: str, target: str) -> list[tuple[TransitionModel, ...]]:
        """Every cycle-free transition path from ``source`` to ``target``.

        The state spaces here are tiny (five states at most), so full
        enumeration is deterministic and cheap; the model-based tests assert
        properties over every path instead of sampling.
        """

        adjacency: dict[str, list[TransitionModel]] = {}
        for item in self.transitions:
            adjacency.setdefault(item.from_state, []).append(item)
        paths: list[tuple[TransitionModel, ...]] = []

        def walk(state: str, visited: frozenset[str], trail: tuple[TransitionModel, ...]) -> None:
            if state == target:
                paths.append(trail)
                return
            for item in adjacency.get(state, ()):
                if item.to_state in visited:
                    continue
                walk(item.to_state, visited | {item.to_state}, trail + (item,))

        walk(source, frozenset({source}), ())
        return paths

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "owner_service": self.owner_service,
            "source_binding": {"file": self.source_file, "type_name": self.source_type_name},
            "states": list(self.states),
            "initial_states": list(self.initial_states),
            "terminal_states": list(self.terminal_states),
            "declared_only_states": list(self.declared_only_states),
            "transitions": [item.to_dict() for item in self.transitions],
            "forbidden_pairs": [list(pair) for pair in self.forbidden_pairs],
            "evidence_ids": list(self.evidence_ids),
        }


@dataclass(frozen=True, slots=True)
class LifecycleCheckResult:
    """Result returned by :func:`check_lifecycle_contracts`."""

    repo_root: str
    compared: bool
    machines: tuple[MachineModel, ...]
    issues: tuple[ValidationIssue, ...]

    @property
    def machine_count(self) -> int:
        return len(self.machines)

    @property
    def state_count(self) -> int:
        return sum(len(machine.states) for machine in self.machines)

    @property
    def transition_count(self) -> int:
        return sum(len(machine.transitions) for machine in self.machines)

    @property
    def error_count(self) -> int:
        return sum(issue.severity == "error" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(issue.severity == "warning" for issue in self.issues)

    @property
    def status(self) -> str:
        # A run that never reached the comparison must not report success even
        # with zero recorded issues (Phase 2 lesson).
        return "passed" if self.compared and self.error_count == 0 else "failed"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": "ai-bim-lifecycle-check-result/v1",
            "repo_root": self.repo_root,
            "status": self.status,
            "compared": self.compared,
            "summary": {
                "machines": self.machine_count,
                "states": self.state_count,
                "transitions": self.transition_count,
                "errors": self.error_count,
                "warnings": self.warning_count,
            },
            "machines": [machine.to_dict() for machine in self.machines],
            "issues": [issue.to_dict() for issue in self.issues],
        }


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #


def _load_lifecycle_contract(
    repo_root: Path,
) -> tuple[Mapping[str, Any] | None, list[ValidationIssue]]:
    return _load_document(
        repo_root,
        CONTRACT_RELATIVE_PATH,
        CONTRACT_SCHEMA_RELATIVE_PATH,
        CONTRACT_SCHEMA_VERSION,
        "lifecycle_contract",
    )


def _load_architecture_contract(
    repo_root: Path,
) -> tuple[Mapping[str, Any] | None, list[ValidationIssue]]:
    return _load_document(
        repo_root,
        ARCHITECTURE_CONTRACT_RELATIVE_PATH,
        ARCHITECTURE_CONTRACT_SCHEMA_RELATIVE_PATH,
        ARCHITECTURE_CONTRACT_SCHEMA_VERSION,
        "lifecycle.architecture_contract",
    )


def _non_empty_string(value: Any) -> TypeGuard[str]:
    return isinstance(value, str) and bool(value.strip())


def _list_of_mappings(value: Any) -> list[Mapping[str, Any]]:
    if not _is_sequence(value):
        return []
    return [item for item in value if _is_mapping(item)]


def _as_mapping(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def _string_items(value: Any) -> list[str]:
    if not _is_sequence(value):
        return []
    return [item for item in value if _non_empty_string(item)]


def _duplicates(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    repeated: list[str] = []
    for value in values:
        if value in seen and value not in repeated:
            repeated.append(value)
        seen.add(value)
    return sorted(repeated)


# --------------------------------------------------------------------------- #
# Machine semantics
# --------------------------------------------------------------------------- #


def _build_machine(
    machine: Mapping[str, Any],
    path: str,
) -> tuple[MachineModel | None, list[ValidationIssue]]:
    """Validate one machine's internal consistency and build its model.

    The JSON Schema has already reported shape violations; this function is
    defensive about shapes anyway so a schema-invalid document still produces
    stable semantic findings instead of a crash.
    """

    issues: list[ValidationIssue] = []
    machine_id = machine.get("id") if _non_empty_string(machine.get("id")) else None
    if machine_id is None:
        issues.append(_issue("lifecycle.machine.id", path, "Machine is missing a usable id."))
        return None, issues

    states = _list_of_mappings(machine.get("states"))
    state_ids = [sid for state in states if _non_empty_string(sid := state.get("id"))]
    for duplicate in _duplicates(state_ids):
        issues.append(
            _issue(
                "lifecycle.state.duplicate",
                f"{path}/states",
                f"State {duplicate!r} is declared more than once in machine {machine_id!r}.",
            )
        )
    state_set = set(state_ids)

    kinds: dict[str, str] = {}
    declared_only: list[str] = []
    for state in states:
        raw_state_id = state.get("id")
        if not _non_empty_string(raw_state_id):
            continue
        state_id = str(raw_state_id)
        kind = state.get("kind")
        kinds[state_id] = kind if kind in STATE_KINDS else ""
        if kind not in STATE_KINDS:
            issues.append(
                _issue(
                    "lifecycle.state.kind",
                    f"{path}/states/{state_id}",
                    f"State {state_id!r} has kind {kind!r}; expected one of {list(STATE_KINDS)!r}.",
                )
            )
        if state.get("runtime_write_path") == "declared_only":
            declared_only.append(state_id)
            if kind == "initial":
                issues.append(
                    _issue(
                        "lifecycle.state.declared_only_initial",
                        f"{path}/states/{state_id}",
                        f"State {state_id!r} is declared_only but marked initial; an initial state is "
                        "by definition entered by the runtime.",
                    )
                )

    initial_states = sorted(state for state, kind in kinds.items() if kind == "initial")
    terminal_states = sorted(state for state, kind in kinds.items() if kind == "terminal")
    if not initial_states:
        issues.append(
            _issue(
                "lifecycle.machine.no_initial",
                path,
                f"Machine {machine_id!r} declares no initial state.",
            )
        )
    if not terminal_states:
        issues.append(
            _issue(
                "lifecycle.machine.no_terminal",
                path,
                f"Machine {machine_id!r} declares no terminal state.",
            )
        )

    transitions_raw = _list_of_mappings(machine.get("transitions"))
    transition_models: list[TransitionModel] = []
    transition_ids: list[str] = []
    seen_from_trigger: dict[tuple[str, str], str] = {}
    for index, transition in enumerate(transitions_raw):
        transition_id = transition.get("id")
        transition_path = f"{path}/transitions[{index}]"
        if not _non_empty_string(transition_id):
            issues.append(
                _issue("lifecycle.transition.id", transition_path, "Transition is missing a usable id.")
            )
            continue
        transition_ids.append(transition_id)
        from_state = transition.get("from")
        to_state = transition.get("to")
        trigger = transition.get("trigger")
        usable = True
        for field_name, value in (("from", from_state), ("to", to_state)):
            if not _non_empty_string(value) or value not in state_set:
                issues.append(
                    _issue(
                        "lifecycle.transition.unknown_state",
                        f"{transition_path}/{field_name}",
                        f"Transition {transition_id!r} references undeclared state {value!r}.",
                    )
                )
                usable = False
        if not _non_empty_string(trigger):
            issues.append(
                _issue(
                    "lifecycle.transition.trigger",
                    f"{transition_path}/trigger",
                    f"Transition {transition_id!r} is missing a usable trigger.",
                )
            )
            usable = False
        if not usable:
            continue
        from_state = str(from_state)
        to_state = str(to_state)
        trigger = str(trigger)
        key = (from_state, trigger)
        if key in seen_from_trigger:
            issues.append(
                _issue(
                    "lifecycle.transition.nondeterministic",
                    transition_path,
                    f"Transitions {seen_from_trigger[key]!r} and {transition_id!r} share (from={from_state!r}, "
                    f"trigger={trigger!r}); a trigger must lead to exactly one target state.",
                )
            )
        else:
            seen_from_trigger[key] = transition_id
        if kinds.get(from_state) == "terminal":
            issues.append(
                _issue(
                    "lifecycle.terminal.outgoing",
                    transition_path,
                    f"Transition {transition_id!r} leaves terminal state {from_state!r}; terminal states "
                    "must be closed.",
                )
            )
        for endpoint in {from_state, to_state}:
            if endpoint in declared_only:
                issues.append(
                    _issue(
                        "lifecycle.state.declared_only_wired",
                        transition_path,
                        f"Transition {transition_id!r} touches declared_only state {endpoint!r}; a state "
                        "with no runtime write path cannot participate in transitions.",
                    )
                )
        transition_models.append(
            TransitionModel(
                id=transition_id,
                from_state=from_state,
                to_state=to_state,
                trigger=trigger,
                evidence_required=tuple(_string_items(transition.get("evidence_required"))),
            )
        )
    for duplicate in _duplicates(transition_ids):
        issues.append(
            _issue(
                "lifecycle.transition.duplicate",
                f"{path}/transitions",
                f"Transition id {duplicate!r} is declared more than once in machine {machine_id!r}.",
            )
        )

    edge_set = {(item.from_state, item.to_state) for item in transition_models}
    forbidden_raw = _list_of_mappings(machine.get("forbidden_shortcuts"))
    forbidden_pairs: list[tuple[str, str]] = []
    forbidden_ids: list[str] = []
    for index, shortcut in enumerate(forbidden_raw):
        shortcut_path = f"{path}/forbidden_shortcuts[{index}]"
        shortcut_id = shortcut.get("id")
        if _non_empty_string(shortcut_id):
            forbidden_ids.append(shortcut_id)
        from_state = shortcut.get("from")
        to_state = shortcut.get("to")
        usable = True
        for field_name, value in (("from", from_state), ("to", to_state)):
            if not _non_empty_string(value) or value not in state_set:
                issues.append(
                    _issue(
                        "lifecycle.forbidden.unknown_state",
                        f"{shortcut_path}/{field_name}",
                        f"Forbidden shortcut {shortcut_id!r} references undeclared state {value!r}.",
                    )
                )
                usable = False
        if not usable:
            continue
        from_state = str(from_state)
        to_state = str(to_state)
        if from_state == to_state:
            issues.append(
                _issue(
                    "lifecycle.forbidden.self_loop",
                    shortcut_path,
                    f"Forbidden shortcut {shortcut_id!r} declares from == to ({from_state!r}), which "
                    "forbids nothing.",
                )
            )
            continue
        pair = (from_state, to_state)
        if pair in forbidden_pairs:
            issues.append(
                _issue(
                    "lifecycle.forbidden.duplicate",
                    shortcut_path,
                    f"Forbidden pair {from_state!r} -> {to_state!r} is declared more than once.",
                )
            )
            continue
        forbidden_pairs.append(pair)
        if pair in edge_set:
            issues.append(
                _issue(
                    "lifecycle.forbidden.direct_edge_exists",
                    shortcut_path,
                    f"Machine {machine_id!r} declares {from_state!r} -> {to_state!r} both as a transition "
                    "and as a forbidden shortcut; the contract contradicts itself.",
                )
            )
    for duplicate in _duplicates(forbidden_ids):
        issues.append(
            _issue(
                "lifecycle.forbidden.duplicate_id",
                f"{path}/forbidden_shortcuts",
                f"Forbidden shortcut id {duplicate!r} is declared more than once.",
            )
        )

    evidence_raw = _list_of_mappings(machine.get("evidence"))
    evidence_ids = [eid for item in evidence_raw if _non_empty_string(eid := item.get("id"))]
    for duplicate in _duplicates(evidence_ids):
        issues.append(
            _issue(
                "lifecycle.evidence.duplicate",
                f"{path}/evidence",
                f"Evidence id {duplicate!r} is declared more than once in machine {machine_id!r}.",
            )
        )
    evidence_set = set(evidence_ids)
    for item in transition_models:
        for evidence_id in item.evidence_required:
            if evidence_id not in evidence_set:
                issues.append(
                    _issue(
                        "lifecycle.evidence.unknown",
                        f"{path}/transitions/{item.id}",
                        f"Transition {item.id!r} requires undeclared evidence {evidence_id!r}.",
                    )
                )

    reentry_raw = _list_of_mappings(machine.get("reentry_rules"))
    reentry_ids: list[str] = []
    for index, rule in enumerate(reentry_raw):
        rule_path = f"{path}/reentry_rules[{index}]"
        rule_id = rule.get("id")
        if _non_empty_string(rule_id):
            reentry_ids.append(rule_id)
        for state in _string_items(rule.get("states")):
            if state not in state_set:
                issues.append(
                    _issue(
                        "lifecycle.reentry.unknown_state",
                        rule_path,
                        f"Reentry rule {rule_id!r} references undeclared state {state!r}.",
                    )
                )
    for duplicate in _duplicates(reentry_ids):
        issues.append(
            _issue(
                "lifecycle.reentry.duplicate",
                f"{path}/reentry_rules",
                f"Reentry rule id {duplicate!r} is declared more than once.",
            )
        )

    source_binding = machine.get("source_binding")
    source_file = ""
    source_type_name = ""
    source_binding = _as_mapping(source_binding)
    if source_binding is not None:
        raw_file = source_binding.get("file")
        raw_type = source_binding.get("type_name")
        source_file = raw_file if _non_empty_string(raw_file) else ""
        source_type_name = raw_type if _non_empty_string(raw_type) else ""

    model = MachineModel(
        id=machine_id,
        owner_service=str(machine.get("owner_service") or ""),
        source_file=source_file,
        source_type_name=source_type_name,
        states=tuple(sorted(state_set)),
        initial_states=tuple(initial_states),
        terminal_states=tuple(terminal_states),
        declared_only_states=tuple(sorted(declared_only)),
        transitions=tuple(transition_models),
        forbidden_pairs=tuple(forbidden_pairs),
        evidence_ids=tuple(sorted(evidence_set)),
    )

    if initial_states:
        reachable = model.reachable_states()
        for state in sorted(state_set - reachable - set(declared_only)):
            issues.append(
                _issue(
                    "lifecycle.state.unreachable",
                    f"{path}/states/{state}",
                    f"State {state!r} in machine {machine_id!r} is not reachable from any initial state "
                    "and is not marked declared_only.",
                )
            )

    return model, issues


# --------------------------------------------------------------------------- #
# Source synchronization
# --------------------------------------------------------------------------- #


def _extract_union_literals(text: str, type_name: str) -> tuple[list[str] | None, str | None]:
    """Extract the string literals of ``export type <name> = "a" | "b";``.

    Returns ``(literals, None)`` on success or ``(None, reason)`` when the
    union cannot be interpreted. Anything but a pure string-literal union is
    rejected (fail closed) rather than partially parsed: a referenced type
    alias, a comment, or single-quoted literals all leave residue.
    """

    pattern = re.compile(r"export\s+type\s+" + re.escape(type_name) + r"\s*=\s*(?P<body>[^;]*);")
    match = pattern.search(text)
    if match is None:
        return None, "type_not_found"
    body = match.group("body")
    literals = re.findall(r'"([^"\\]*)"', body)
    residue = re.sub(r'"[^"\\]*"', "", body).replace("|", " ").strip()
    if residue:
        return None, "unsupported_union"
    if not literals:
        return None, "no_literals"
    if len(set(literals)) != len(literals):
        return None, "duplicate_literals"
    if any(not literal for literal in literals):
        return None, "empty_literal"
    return literals, None


def _check_source_sync(
    repo_root: Path,
    machine: MachineModel,
    path: str,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if not machine.source_file or not machine.source_type_name:
        issues.append(
            _issue(
                "lifecycle.source_sync.binding_missing",
                path,
                f"Machine {machine.id!r} has no usable source_binding; the state set cannot be "
                "synchronized with the owning source union.",
            )
        )
        return issues
    parts = machine.source_file.replace("\\", "/").split("/")
    if any(part in ("", ".", "..") for part in parts):
        issues.append(
            _issue(
                "lifecycle.source_binding.path_escape",
                path,
                f"Machine {machine.id!r} source_binding file {machine.source_file!r} contains empty, "
                "'.' or '..' segments; only plain repo-relative paths are allowed.",
            )
        )
        return issues
    source_path = repo_root / machine.source_file
    try:
        text = source_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        issues.append(
            _issue(
                "lifecycle.source_sync.file_unreadable",
                path,
                f"Machine {machine.id!r} source file {machine.source_file!r} could not be read: {exc}.",
            )
        )
        return issues
    literals, reason = _extract_union_literals(text, machine.source_type_name)
    if literals is None:
        issues.append(
            _issue(
                "lifecycle.source_sync.union_unparsed",
                path,
                f"Machine {machine.id!r} could not synchronize with type {machine.source_type_name!r} in "
                f"{machine.source_file!r}: {reason}. Only a pure string-literal union is supported; "
                "anything else must fail closed rather than partially parse.",
            )
        )
        return issues
    source_states = set(literals)
    contract_states = set(machine.states)
    for state in sorted(source_states - contract_states):
        issues.append(
            _issue(
                "lifecycle.source_sync.state_missing_in_contract",
                path,
                f"Source union {machine.source_type_name!r} declares state {state!r} that machine "
                f"{machine.id!r} does not; update the lifecycle contract in the same change.",
            )
        )
    for state in sorted(contract_states - source_states):
        issues.append(
            _issue(
                "lifecycle.source_sync.state_missing_in_source",
                path,
                f"Machine {machine.id!r} declares state {state!r} that source union "
                f"{machine.source_type_name!r} does not; the contract may only describe the current "
                "runtime truth.",
            )
        )
    return issues


# --------------------------------------------------------------------------- #
# Contract-level semantics
# --------------------------------------------------------------------------- #


def _check_cross_machine_rules(
    contract: Mapping[str, Any],
    machines: Mapping[str, MachineModel],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    rules = _list_of_mappings(contract.get("cross_machine_rules"))
    rule_ids: list[str] = []
    for index, rule in enumerate(rules):
        rule_path = f"$.cross_machine_rules[{index}]"
        rule_id = rule.get("id")
        if _non_empty_string(rule_id):
            rule_ids.append(rule_id)
        listed = _string_items(rule.get("machines"))
        for machine_id in listed:
            if machine_id not in machines:
                issues.append(
                    _issue(
                        "lifecycle.cross.unknown_machine",
                        rule_path,
                        f"Cross-machine rule {rule_id!r} references undeclared machine {machine_id!r}.",
                    )
                )
        for requirement in _list_of_mappings(rule.get("required_states")):
            machine_id = requirement.get("machine")
            if machine_id not in machines:
                issues.append(
                    _issue(
                        "lifecycle.cross.unknown_machine",
                        rule_path,
                        f"Cross-machine rule {rule_id!r} requires states of undeclared machine "
                        f"{machine_id!r}.",
                    )
                )
                continue
            if machine_id not in listed:
                issues.append(
                    _issue(
                        "lifecycle.cross.unlisted_machine",
                        rule_path,
                        f"Cross-machine rule {rule_id!r} requires states of machine {machine_id!r} "
                        "without listing it under machines.",
                    )
                )
            declared = set(machines[str(machine_id)].states)
            for state in _string_items(requirement.get("any_of")):
                if state not in declared:
                    issues.append(
                        _issue(
                            "lifecycle.cross.unknown_state",
                            rule_path,
                            f"Cross-machine rule {rule_id!r} requires undeclared state {state!r} of "
                            f"machine {machine_id!r}.",
                        )
                    )
        cascade = _as_mapping(rule.get("cascade"))
        if cascade is not None:
            from_machine = cascade.get("from_machine")
            to_machine = cascade.get("to_machine")
            for field_name, machine_id in (("from_machine", from_machine), ("to_machine", to_machine)):
                if machine_id not in machines:
                    issues.append(
                        _issue(
                            "lifecycle.cross.unknown_machine",
                            f"{rule_path}/cascade/{field_name}",
                            f"Cross-machine rule {rule_id!r} cascade references undeclared machine "
                            f"{machine_id!r}.",
                        )
                    )
                elif machine_id not in listed:
                    issues.append(
                        _issue(
                            "lifecycle.cross.unlisted_machine",
                            f"{rule_path}/cascade/{field_name}",
                            f"Cross-machine rule {rule_id!r} cascade uses machine {machine_id!r} "
                            "without listing it under machines.",
                        )
                    )
            if from_machine in machines:
                triggers = {item.trigger for item in machines[str(from_machine)].transitions}
                on_trigger = cascade.get("on_trigger")
                if on_trigger not in triggers:
                    issues.append(
                        _issue(
                            "lifecycle.cross.unknown_trigger",
                            f"{rule_path}/cascade/on_trigger",
                            f"Cross-machine rule {rule_id!r} cascade fires on trigger {on_trigger!r}, "
                            f"which no transition of machine {from_machine!r} declares.",
                        )
                    )
            if to_machine in machines:
                transition_ids = {item.id for item in machines[str(to_machine)].transitions}
                applied = cascade.get("applies_transition")
                if applied not in transition_ids:
                    issues.append(
                        _issue(
                            "lifecycle.cross.unknown_transition",
                            f"{rule_path}/cascade/applies_transition",
                            f"Cross-machine rule {rule_id!r} cascade applies transition {applied!r}, "
                            f"which machine {to_machine!r} does not declare.",
                        )
                    )
    for duplicate in _duplicates(rule_ids):
        issues.append(
            _issue(
                "lifecycle.cross.duplicate",
                "$.cross_machine_rules",
                f"Cross-machine rule id {duplicate!r} is declared more than once.",
            )
        )
    return issues


def _check_readiness_binding(
    contract: Mapping[str, Any],
    machines: Mapping[str, MachineModel],
    architecture: Mapping[str, Any] | None,
    known_services: set[str],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    binding = _as_mapping(contract.get("readiness_binding"))
    if binding is None:
        issues.append(
            _issue(
                "lifecycle.readiness.missing",
                "$.readiness_binding",
                "readiness_binding must be an object binding the readiness policy evidence to providers.",
            )
        )
        return issues

    policy_id = binding.get("policy_id")
    bindings = _list_of_mappings(binding.get("evidence_bindings"))
    bound_ids = [bid for item in bindings if _non_empty_string(bid := item.get("evidence_id"))]
    for duplicate in _duplicates(bound_ids):
        issues.append(
            _issue(
                "lifecycle.readiness.duplicate_evidence",
                "$.readiness_binding",
                f"Evidence id {duplicate!r} is bound more than once.",
            )
        )
    for index, item in enumerate(bindings):
        provider = item.get("provider")
        item_path = f"$.readiness_binding.evidence_bindings[{index}]"
        if not _non_empty_string(provider):
            issues.append(
                _issue(
                    "lifecycle.readiness.provider",
                    item_path,
                    "Evidence binding is missing a usable provider.",
                )
            )
            continue
        if provider in machines:
            evidence_id = item.get("evidence_id")
            if evidence_id not in set(machines[provider].evidence_ids):
                issues.append(
                    _issue(
                        "lifecycle.readiness.unknown_machine_evidence",
                        item_path,
                        f"Evidence {evidence_id!r} is attributed to machine {provider!r}, which does not "
                        "declare it.",
                    )
                )
        elif provider not in known_services:
            issues.append(
                _issue(
                    "lifecycle.readiness.unknown_provider",
                    item_path,
                    f"Provider {provider!r} is neither a declared machine nor an architecture-contract "
                    "service.",
                )
            )

    if architecture is None:
        issues.append(
            _issue(
                "lifecycle.readiness.policy_unverifiable",
                "$.readiness_binding",
                "The architecture contract could not be loaded, so the readiness binding cannot be "
                "verified against the readiness policy; failing closed.",
            )
        )
        return issues

    policies = {
        pid: policy
        for policy in _list_of_mappings(architecture.get("readiness_policies"))
        if _non_empty_string(pid := policy.get("id"))
    }
    policy = policies.get(policy_id) if isinstance(policy_id, str) else None
    if policy is None:
        issues.append(
            _issue(
                "lifecycle.readiness.unknown_policy",
                "$.readiness_binding.policy_id",
                f"Readiness policy {policy_id!r} is not declared by the architecture contract.",
            )
        )
        return issues
    required = {
        rid
        for item in _list_of_mappings(policy.get("required_evidence"))
        if _non_empty_string(rid := item.get("id"))
    }
    bound = set(bound_ids)
    for missing in sorted(required - bound):
        issues.append(
            _issue(
                "lifecycle.readiness.evidence_unbound",
                "$.readiness_binding",
                f"Required readiness evidence {missing!r} has no provider binding.",
            )
        )
    for extra in sorted(bound - required):
        issues.append(
            _issue(
                "lifecycle.readiness.evidence_undeclared",
                "$.readiness_binding",
                f"Evidence {extra!r} is bound but the readiness policy does not require it.",
            )
        )
    return issues


def _check_unused_evidence(
    contract: Mapping[str, Any],
    machines: Mapping[str, MachineModel],
) -> list[ValidationIssue]:
    """Evidence nobody consumes is drift, reported as a warning.

    An evidence declaration is consumed either by a transition's
    ``evidence_required`` or by a readiness evidence binding whose provider is
    the declaring machine.
    """

    issues: list[ValidationIssue] = []
    readiness = _as_mapping(contract.get("readiness_binding"))
    readiness_used: set[tuple[str, str]] = set()
    if readiness is not None:
        for item in _list_of_mappings(readiness.get("evidence_bindings")):
            provider = item.get("provider")
            evidence_id = item.get("evidence_id")
            if _non_empty_string(provider) and _non_empty_string(evidence_id):
                readiness_used.add((provider, evidence_id))
    for machine in machines.values():
        used = {
            evidence_id
            for transition in machine.transitions
            for evidence_id in transition.evidence_required
        }
        for evidence_id in machine.evidence_ids:
            if evidence_id in used or (machine.id, evidence_id) in readiness_used:
                continue
            issues.append(
                _issue(
                    "lifecycle.evidence.unused",
                    f"$.machines/{machine.id}/evidence/{evidence_id}",
                    f"Evidence {evidence_id!r} of machine {machine.id!r} is consumed by no transition "
                    "and no readiness binding.",
                    severity="warning",
                )
            )
    return issues


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def check_lifecycle_contracts(repo_root: Path) -> LifecycleCheckResult:
    """Validate the lifecycle contract and its source synchronization."""

    repo_root = Path(repo_root).resolve()
    issues: list[ValidationIssue] = []

    contract, contract_issues = _load_lifecycle_contract(repo_root)
    issues.extend(contract_issues)
    architecture, architecture_issues = _load_architecture_contract(repo_root)
    issues.extend(architecture_issues)

    if contract is None:
        return LifecycleCheckResult(
            repo_root=str(repo_root),
            compared=False,
            machines=(),
            issues=_finalize(issues),
        )

    machines: dict[str, MachineModel] = {}
    machine_ids: list[str] = []
    for index, machine in enumerate(_list_of_mappings(contract.get("machines"))):
        model, machine_issues = _build_machine(machine, f"$.machines[{index}]")
        issues.extend(machine_issues)
        if model is None:
            continue
        machine_ids.append(model.id)
        if model.id not in machines:
            machines[model.id] = model
    for duplicate in _duplicates(machine_ids):
        issues.append(
            _issue(
                "lifecycle.machine.duplicate",
                "$.machines",
                f"Machine id {duplicate!r} is declared more than once.",
            )
        )

    known_services: set[str] = set()
    if architecture is not None:
        known_services = {
            service_id
            for service in _list_of_mappings(architecture.get("services"))
            if _non_empty_string(service_id := service.get("id"))
        }
        for machine in machines.values():
            if machine.owner_service not in known_services:
                issues.append(
                    _issue(
                        "lifecycle.machine.unknown_service",
                        f"$.machines/{machine.id}",
                        f"Machine {machine.id!r} names owner service {machine.owner_service!r}, which the "
                        "architecture contract does not declare.",
                    )
                )
    else:
        issues.append(
            _issue(
                "lifecycle.machine.owner_unverifiable",
                "$.machines",
                "The architecture contract could not be loaded, so machine owner services cannot be "
                "verified; failing closed.",
            )
        )

    for machine in machines.values():
        issues.extend(_check_source_sync(repo_root, machine, f"$.machines/{machine.id}/source_binding"))

    issues.extend(_check_cross_machine_rules(contract, machines))
    issues.extend(_check_readiness_binding(contract, machines, architecture, known_services))
    issues.extend(_check_unused_evidence(contract, machines))

    return LifecycleCheckResult(
        repo_root=str(repo_root),
        compared=True,
        machines=tuple(machines[machine_id] for machine_id in sorted(machines)),
        issues=_finalize(issues),
    )


def _finalize(issues: Iterable[ValidationIssue]) -> tuple[ValidationIssue, ...]:
    return tuple(
        sorted(set(issues), key=lambda item: (item.severity, item.path, item.code, item.message))
    )
