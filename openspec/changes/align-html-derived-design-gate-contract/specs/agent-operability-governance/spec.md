## ADDED Requirements

### Requirement: Design gate SHALL use a closed policy and ref-bound tracked HTML source collection

The design gate SHALL define its current HTML source set from the Git-tracked result of `git ls-files -- 'docs/plans/*.html'`. Base/head collection SHALL use the equivalent ref-bound Git tree query and SHALL NOT use a working-tree directory scan.

The initial policy registry SHALL contain exactly:

- `ai-bim-frontend-backend-design` → `docs/plans/AI-BIM 前後端設計文件.dc.html` → `architecture_behavior`
- `ai-bim-console-hifi` → `docs/plans/AI-BIM Console Hi-Fi.dc.html` → `console_hifi_visual`

Each source SHALL have a unique `source_id`, repo-relative path, and `source_role`. The collector SHALL retain the requested ref, resolved commit, Git blob OID, and SHA-256 of the raw Git blob bytes as source-collection integrity data. Base-only sources SHALL remain visible when deleted from head. These integrity fields SHALL NOT be represented as field-level provenance or as a status classifier.

Engineering policy SHALL be versioned at `scripts/config/design-gate-policy.json` under a closed schema. It SHALL preserve the currently verified Windows/Chromium, DPR1, viewport, locale/timezone, animation, pixel comparison, semantic parity, and full-completion eligibility values, and SHALL NOT contain a self-referential `policy_digest`.

Invalid policy schema, missing or unknown keys, duplicate source identity, unregistered or role-ambiguous sources, external paths, origin projections, untracked files, ignored files, or unresolved base/head collection SHALL fail closed. The validator SHALL NOT use PR prose, screenshots, caller-supplied digests, working-tree bytes, or manual booleans as authority. Manifest, golden, baseline, capture, and rebaseline surfaces SHALL remain read-only.

#### Scenario: Validate the current ref-bound source registry

- **GIVEN** a valid closed policy registers the two Git-tracked HTML sources
- **WHEN** the collector resolves the current checkout or a named Git ref
- **THEN** each result SHALL contain the registered source ID, path, and role
- **AND** its commit, blob OID, and SHA-256 SHALL match the raw Git blob bytes at that ref
- **AND** the collector SHALL NOT read untracked or ignored HTML as authority.

#### Scenario: Preserve base-only source deletion visibility

- **GIVEN** a registered HTML source exists in base and is deleted or renamed in head
- **WHEN** the collector evaluates the base/head source sets
- **THEN** the base-only source SHALL remain visible in the collection result
- **AND** the deletion or rename SHALL NOT shrink the governed source set silently.

#### Scenario: Fail closed for an unregistered or untrusted source

- **GIVEN** an HTML input is external, origin-projected, untracked, ignored, unregistered, or role-ambiguous
- **WHEN** the collector validates that input
- **THEN** validation SHALL fail with the matching source error
- **AND** no caller-supplied digest, PR prose, screenshot, or manual boolean SHALL substitute for Git authority
- **AND** the collector SHALL NOT emit successful eligibility.

#### Scenario: Fail closed for an invalid closed policy

- **GIVEN** the policy is missing, malformed, has an unsupported schema, contains an unknown or missing required key, duplicates a source identity, or contains `policy_digest`
- **WHEN** the policy validator evaluates it
- **THEN** validation SHALL fail with the matching schema error
- **AND** no manifest field or caller-provided value SHALL replace the invalid policy
- **AND** the manifest, golden, baseline, capture, and rebaseline surfaces SHALL remain unchanged.
