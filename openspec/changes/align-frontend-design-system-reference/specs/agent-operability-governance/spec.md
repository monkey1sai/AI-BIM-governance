## MODIFIED Requirements

### Requirement: Agent boundary SHALL align A1-A10 product positioning

The repo agent contract SHALL identify A1-A10 as the main product development items, SHALL use the repo-pinned `desigin-system` reference for production 2D UX/IA/visual states, and SHALL use TARGET/contracts plus code/tests for behavior and runtime truth. The external design source SHALL NOT override API, enum, security, authority, or runtime lifecycle.

#### Scenario: Agent starts user-facing governance work

- **GIVEN** an agent is asked to modify a user-facing governance capability
- **WHEN** the agent reads the repo contract
- **THEN** the agent SHALL map the work to the relevant A1-A10 item and approved design screen/state
- **AND** the agent SHALL consult both design fidelity and frontend operability guidance before claiming done
- **AND** the agent SHALL NOT treat backend/API, visual-only, or runtime-only completion as full user-facing completion

### Requirement: User-facing completion SHALL be frontend-operable

Every user-facing capability SHALL pass two independent gates: (1) an approved design screen/state on a Windows runner at Chromium DPR1, `1440x900` and `1920x1080`, with each viewport pixel diff ratio `<=0.01` and required semantic states at 100%; (2) a functional browser flow with route, visible controls, default fixture, real backend API, loading/success/failure/retry states, runtime identifiers, screenshot/trace/network evidence, and Kit first-frame/stage/DataChannel evidence when applicable. Design scope SHALL be derived from changed paths plus the stricter base/head manifest union, never selected by PR prose.

#### Scenario: User verifies a capability from browser UI

- **GIVEN** the development server and default fixture are available
- **WHEN** the user opens the documented route and clicks the documented action
- **THEN** the system SHALL call the real backend API and display honest visible states plus resulting domain/runtime IDs
- **AND** branch-protected Playwright SHALL execute exact manifest semantic cases against the current checkout and emit the design result; PR/external JSON SHALL NOT be gate input
- **AND** the PR SHALL include independent functional browser evidence
- **AND** `reference_missing`, a pixel ratio above 1%, an incomplete semantic result, or missing runtime evidence SHALL prevent a full-completion claim
- **AND** live WebRTC/GPU frames SHALL NOT be judged by the design pixel threshold

#### Scenario: Shared product bundle affects approved and missing routes

- **GIVEN** changed paths resolve to approved screens and `reference_missing` routes
- **WHEN** the PR evidence is checked
- **THEN** `Design gate status` SHALL be `mixed`, every manifest-approved screen SHALL be required, and every missing route/surface SHALL be disclosed
- **AND** `Full completion claimed` SHALL be `no`
- **AND** functional/runtime evidence SHALL remain independently required

#### Scenario: Product surface has no approved design reference

- **GIVEN** changed paths resolve only to a manifest `reference_missing` surface
- **WHEN** the PR evidence is checked
- **THEN** `Design gate status` SHALL be `partial_reference_missing`, design result/comparison/artifacts SHALL be `reference_missing`, and full completion SHALL be `no`
- **AND** honest bug, security, or partial feature work MAY proceed when its functional/runtime gate passes
- **AND** no legacy screenshot SHALL be promoted to an approved design result

#### Scenario: Semantic variants are incomplete

- **GIVEN** semantic contract status is not executable or implemented cases differ from required cases
- **WHEN** an approved or mixed frontend product job runs
- **THEN** the design job SHALL fail closed
- **AND** gate infrastructure or golden existence SHALL NOT be reported as production 99% alignment
