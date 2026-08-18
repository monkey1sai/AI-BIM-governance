## MODIFIED Requirements

### Requirement: Agent boundary SHALL align A1-A10 product positioning

The repo agent contract SHALL identify `https://bim-docs.jackshappybot.com/` page「05 BIM治理與模型檢核」A1-A10 as the main product development items for this repo, and page「06 操作介面總覽」as the user-operation reference for UI routes, buttons, progress, and validation flows. The design site SHALL guide product positioning and operability semantics, while code and contracts remain the behavior source of truth. For design-gate work, the agent SHALL use the canonical tracked-HTML, policy/provenance, and base/head classifier contract before claiming completion.

#### Scenario: Agent starts user-facing governance work

- **GIVEN** an agent is asked to modify a user-facing governance capability
- **WHEN** the agent reads the repo contract
- **THEN** the agent SHALL map the work to the relevant A1-A10 product item
- **AND** the agent SHALL consult the frontend operability guidance before claiming done
- **AND** the agent SHALL NOT treat backend/API completion as full user-facing completion
- **AND** the agent SHALL classify applicable design-gate evidence through the canonical source, provenance, and base/head contract.

### Requirement: User-facing completion SHALL be frontend-operable

Every user-facing capability SHALL be verifiable from a frontend screen. Completion SHALL require a documented frontend route, visible controls/buttons, default fixture data, loading/success/failure/retry UI states, relevant runtime identifiers, and browser E2E evidence where applicable. Design-fidelity evidence and functional/runtime E2E evidence SHALL remain independent, and neither SHALL substitute for the other.

#### Scenario: User verifies a capability from browser UI

- **GIVEN** the development server is running
- **AND** default fixture data is available
- **WHEN** the user opens the documented frontend route
- **AND** clicks the documented action button
- **THEN** the system SHALL call the real backend API
- **AND** the frontend SHALL display loading, success, and failure states
- **AND** the resulting domain object SHALL be visible in the UI
- **AND** the PR SHALL include browser E2E command and screenshot or trace evidence when the capability is user-facing
- **AND** a design-gate `passed` result SHALL NOT by itself establish functional/runtime completion.

## ADDED Requirements

### Requirement: Design gate SHALL use ref-bound tracked HTML and policy provenance

The design gate SHALL define its HTML source set from the Git-tracked result of `git ls-files -- 'docs/plans/*.html'`; base/head evaluation SHALL use the equivalent ref-bound Git tree query and SHALL NOT use a working-tree directory scan. The initial registry SHALL contain exactly these mappings:

- `ai-bim-frontend-backend-design` → `docs/plans/AI-BIM 前後端設計文件.dc.html` → `architecture_behavior`
- `ai-bim-console-hifi` → `docs/plans/AI-BIM Console Hi-Fi.dc.html` → `console_hifi_visual`

Each source SHALL have a unique `source_id`, unique path and `source_role`. HTML-derived evidence SHALL identify the repo-relative source path, resolved ref/commit, SHA-256 of the raw Git blob bytes, machine-resolvable semantic locator, and extractor/schema version. The validator SHALL use no external path, origin projection, screenshot, PR prose, untracked file, ignored file, or manual boolean as authority.

Engineering policy SHALL be versioned at `scripts/config/design-gate-policy.json` under a closed schema. Its initial values SHALL preserve the currently verified manifest contract, including Windows `windows-2025`, Chromium, DPR1, `1440x900` and `1920x1080`, locale `zh-TW`, timezone `Asia/Taipei`, animations disabled, pixelmatch threshold `0.1`, max diff ratio `0.01`, and semantic parity `1.0`. Policy-derived evidence SHALL identify the policy path, resolved ref/commit, SHA-256 of the raw policy Git blob bytes, and exact policy key. The policy SHALL NOT contain a self-referential digest. Missing, unknown, drifted, stale, mismatched, role-ambiguous, or non-resolvable source or policy provenance SHALL produce `unknown_fail_closed` and SHALL NOT produce `passed`.

Validation and classification SHALL be read-only toward `docs/plans/design-system-reference.manifest.json`, golden images, baselines, capture scripts, and rebaseline behavior. Design-fidelity evidence SHALL remain independent from functional/runtime evidence.

#### Scenario: Validate the current ref-bound source registry

- **GIVEN** resolved base and head refs contain the two registered tracked HTML sources
- **AND** `scripts/config/design-gate-policy.json` is valid and versioned
- **WHEN** the validator derives source and policy evidence
- **THEN** every governed field SHALL resolve to the correct source or policy provenance record
- **AND** every digest SHALL match the raw Git blob bytes at the resolved ref/commit
- **AND** the validator SHALL leave the manifest, golden, baseline, capture, and rebaseline surfaces unchanged.

#### Scenario: Fail closed for an unregistered or untrusted source

- **GIVEN** a tracked HTML source is added, deleted, renamed, role-ambiguous, external, untracked, drifted, or missing resolvable provenance
- **WHEN** the validator evaluates the base/head source union
- **THEN** it SHALL return `unknown_fail_closed`
- **AND** it SHALL NOT return `passed`
- **AND** it SHALL NOT use PR prose, a screenshot, a caller-supplied digest, or a missing field as substitute authority.

#### Scenario: Fail closed for policy drift

- **GIVEN** the policy is missing, malformed, has an unsupported schema, contains an unknown or missing required key, or its derived digest does not match the ref-bound policy blob
- **WHEN** design-gate evidence is validated
- **THEN** the result SHALL be `unknown_fail_closed`
- **AND** no manifest field or caller-provided value SHALL replace the invalid policy evidence.

### Requirement: Design gate SHALL apply the exact base/head classifier contract

The classifier SHALL evaluate the union of base/head tracked HTML sources, policy, manifest mappings, path ownership, and changed paths. Base-only sources and mappings SHALL remain in scope when absent from head. The canonical status enum SHALL contain exactly these eight values, in this order:

1. `passed`
2. `mixed`
3. `partial_reference_missing`
4. `design_source_update_only`
5. `gate_infrastructure_only`
6. `design_source_and_product_mixed_fail_closed`
7. `unknown_fail_closed`
8. `not_applicable`

The classifier SHALL apply the following precedence:

1. Invalid, missing, unknown, drifted, stale, unverifiable, unowned, or unsupported input/path combinations SHALL produce `unknown_fail_closed`.
2. A change containing both tracked authority HTML and production UI SHALL produce `design_source_and_product_mixed_fail_closed`.
3. `mixed` SHALL mean product scope contains both an approved surface and a reference-missing surface, including an approved-surface declaration that also affects a missing route.
4. Product scope containing only approved surfaces SHALL produce `passed`.
5. Product scope containing only reference-missing surfaces SHALL produce `partial_reference_missing`.
6. Scope containing tracked authority HTML plus only its allowed derivatives or required gate infrastructure, and no product path, SHALL produce `design_source_update_only`.
7. Scope containing only design-gate policy, validator, classifier, CI, or test infrastructure SHALL produce `gate_infrastructure_only`.
8. A valid registered backend/docs-only scope with no design/product impact SHALL produce `not_applicable`.

`reference_authority_mixed_fail_closed` SHALL be rejected as a legacy value. Producers and consumers SHALL NOT accept the legacy and replacement values simultaneously. `passed` SHALL be the only status eligible to enter full-completion evaluation, but SHALL NOT be sufficient by itself; applicable semantic, visual, functional, runtime, and independent E2E evidence SHALL also be present. `mixed` and `partial_reference_missing` SHALL require `Full completion claimed=no`. `design_source_update_only`, `gate_infrastructure_only`, and `not_applicable` SHALL NOT be reported as product design passes; `not_applicable` SHALL remain a valid N/A result.

#### Scenario: Preserve the base/head union and exact mixed semantics

- **GIVEN** base and head refs are valid and their source, manifest, and ownership mappings are unioned
- **WHEN** the classifier evaluates changed paths and reference coverage
- **THEN** it SHALL preserve base-only mappings rather than shrinking scope
- **AND** approved-only product scope SHALL emit `passed`
- **AND** approved plus reference-missing product scope SHALL emit `mixed`
- **AND** an approved surface declared to affect a missing route SHALL also emit `mixed`.

#### Scenario: Reject a source and product moving-goalpost change

- **GIVEN** changed paths contain tracked authority HTML and production UI
- **WHEN** the classifier evaluates the change
- **THEN** it SHALL emit `design_source_and_product_mixed_fail_closed`
- **AND** no approved reference or runtime evidence SHALL promote the result to `passed`.

#### Scenario: Classify missing and non-product scopes

- **GIVEN** separately evaluated scopes contain only reference-missing product surfaces, only tracked authority HTML plus allowed derivatives, or only gate infrastructure
- **WHEN** the classifier evaluates each isolated scope
- **THEN** the reference-missing product scope SHALL emit `partial_reference_missing`
- **AND** the source/derivative scope SHALL emit `design_source_update_only`
- **AND** the gate-only scope SHALL emit `gate_infrastructure_only`
- **AND** none of these three results SHALL permit a full-completion claim.

#### Scenario: Preserve backend N/A and reject the legacy status

- **GIVEN** a valid backend-only/no-design change or an input containing `reference_authority_mixed_fail_closed`
- **WHEN** the classifier validates the input
- **THEN** the backend-only/no-design change SHALL emit `not_applicable`
- **AND** the legacy value SHALL be rejected as invalid input
- **AND** no consumer SHALL accept both status spellings.

#### Scenario: Keep design and runtime completion independent

- **GIVEN** the classifier emits `passed` for an applicable browser design scope
- **WHEN** completion evidence is evaluated
- **THEN** `passed` SHALL provide eligibility only and SHALL NOT establish full completion
- **AND** independent functional/runtime E2E evidence SHALL remain required
- **AND** live GPU/Kit/WebRTC evidence SHALL NOT be treated as a design pixel golden.

#### Scenario: Treat GPU Kit and WebRTC as N/A for governance-only scope

- **GIVEN** a change is limited to design-gate policy, validator, classifier, or contract tests and does not touch runtime paths
- **WHEN** its validation matrix is reported
- **THEN** GPU, Kit, WebRTC, first-frame, stage, and DataChannel validation SHALL be reported as `N/A`
- **AND** the N/A result SHALL NOT be reported as a runtime or product pass
- **AND** a future product change that touches those runtime paths SHALL still provide its separately applicable runtime evidence.
