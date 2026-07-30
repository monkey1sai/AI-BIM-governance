# Capability: Executable Architecture Contracts

## ADDED Requirements

### Requirement: Desired architecture contract

The repository SHALL maintain a machine-readable desired architecture contract at `architecture/architecture-contract.json`.

The contract SHALL identify internal services, external systems, owned capabilities, forbidden responsibilities, allowed service calls, browser access boundaries, data residency policy, runtime readiness evidence, architecture invariants, delta policy, and exception policy.

#### Scenario: Agent plans a governed service-boundary change

- **GIVEN** a Lane G or Lane S change may alter a service boundary
- **WHEN** the agent prepares the change
- **THEN** it SHALL read the desired architecture contract
- **AND** it SHALL NOT infer permission from narrative documentation alone
- **AND** any new dependency edge SHALL be present in both the desired contract and the change delta before acceptance.

### Requirement: Runtime truth hierarchy

The architecture contract SHALL preserve the repository runtime truth hierarchy.

#### Scenario: Documentation describes target behavior that code does not implement

- **GIVEN** `docs/plans` describes a target capability
- **AND** implementation or executable tests do not prove that capability exists
- **WHEN** an agent reports status
- **THEN** it SHALL report an implementation gap
- **AND** it SHALL NOT use the architecture contract or narrative spec to claim runtime completion.

### Requirement: Unique capability ownership

Every declared architectural capability SHALL have no more than one internal owning service.

A service SHALL NOT list the same capability under both `owns` and `must_not`.

#### Scenario: Two services claim review-session ownership

- **GIVEN** `bim-review-coordinator` owns `review-session`
- **WHEN** another internal service also declares ownership of `review-session`
- **THEN** semantic validation SHALL fail
- **AND** the failure SHALL identify both owners and the duplicated capability.

### Requirement: Browser access boundary

The only public browser HTTP API entrypoint SHALL be `bim-review-coordinator` on port `8004`.

`bim-streaming-server`, `governance-service`, and `kit-manager-api` SHALL NOT be declared as direct public browser HTTP APIs.

The browser MAY use declared WebRTC and DataChannel channels to `bim-streaming-server`.

#### Scenario: Viewer attempts to bypass coordinator

- **WHEN** an architecture contract or delta declares direct browser HTTP access to governance or streaming internal APIs
- **THEN** validation SHALL fail.

### Requirement: Customer-edge artifact residency

Large BIM source and derived artifacts SHALL remain customer-edge authoritative.

The external company cloud control plane SHALL receive metadata only and SHALL NOT receive IFC, RVT, DWG, USD, USDC, element mapping, or entity index artifacts.

#### Scenario: Cloud data policy permits USDC upload

- **WHEN** the architecture contract removes USDC from the cloud deny-list or marks large artifacts cloud-transferable
- **THEN** validation SHALL fail.

### Requirement: Evidence-gated review readiness

A review session SHALL NOT be considered ready unless all required Kit-side and browser-side evidence exists.

The required evidence SHALL include at least:

- `kit-process-alive`;
- `opened-stage-result`;
- `datachannel-ready`;
- `first-frame-at`;
- `stage-matched`.

#### Scenario: Kit process exists but browser has no first frame

- **GIVEN** Kit process evidence exists
- **AND** `first-frame-at` is absent
- **WHEN** readiness is evaluated
- **THEN** the session SHALL NOT be ready.

### Requirement: Architecture delta

A governed architecture change SHALL include `architecture/deltas/<change-id>.json`.

The delta SHALL declare affected services and surfaces, dependency edges, public contract changes, data ownership changes, state-machine changes, exceptions, and approval state.

#### Scenario: Lane B carries architecture-affecting changes

- **GIVEN** a delta contains a dependency edge, public contract change, ownership change, state-machine change, or exception
- **WHEN** its lane is `F` or `B`
- **THEN** validation SHALL fail
- **AND** the change SHALL be promoted to Lane G or Lane S.

### Requirement: Time-bounded architecture exceptions

An architecture exception SHALL include invariant ID, owner, reason, ADR, creation date, and expiration date.

An exception SHALL NOT exceed 90 days and SHALL fail validation after expiration.

Breaking contract changes, ownership transfers, and architecture exceptions SHALL require explicit approved status before acceptance.

#### Scenario: Exception expires

- **GIVEN** an exception expiration date is earlier than the validation date
- **WHEN** semantic validation runs
- **THEN** validation SHALL fail closed.

### Requirement: Canonical verification dispatch

Architecture contract, delta, validator, and architecture-test changes SHALL be routed through the repository's existing verification manifest.

The change SHALL NOT create a second canonical deploy or verification entrypoint.

#### Scenario: Architecture-only change is planned

- **GIVEN** `architecture/architecture-contract.json` changes
- **WHEN** `scripts/verify-all` computes affected targets
- **THEN** root contracts SHALL be selected
- **AND** agent-governance and secret-pattern scanning SHALL remain applicable.

### Requirement: Honest phased enforcement

The repository SHALL distinguish active, delegated, and planned architecture enforcement.

#### Scenario: No-cycle observed-graph gate is not yet implemented

- **WHEN** the first version of executable architecture contracts is reported
- **THEN** `ARCH-GRAPH-001` SHALL remain marked planned
- **AND** the report SHALL NOT claim source-graph conformance or no-cycle enforcement has been completed.
