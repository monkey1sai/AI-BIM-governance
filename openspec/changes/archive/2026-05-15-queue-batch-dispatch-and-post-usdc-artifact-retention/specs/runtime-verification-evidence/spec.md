## ADDED Requirements

### Requirement: Full canonical batch evidence MAY be produced incrementally via the resumable queue

Runtime verification evidence for the full canonical batch MAY be produced incrementally by dispatching one fixture per `--run-next` invocation against the persisted queue manifest, instead of one monolithic process. The evidence MUST be derivable entirely from the persisted manifest rows.

`outcome_distribution` and `minimum_coverage_locked` for a queue-produced batch MUST be computed with semantics identical to the predecessor monolithic path: the same five buckets (`passed`, `passed_with_quality_warning`, `timed_out`, `failed`, `blocked`) and the same lock gate (not a partial subset AND every fixture in the `passed` bucket AND every fixture's per-fixture baseline locked). A queue run carried to completion over the canonical fixture set MUST yield the same `outcome_distribution` and `minimum_coverage_locked` as the monolithic path would on the same inputs.

A resumed batch MUST NOT auto-retry a fixture that already has a recorded `failed` or `timed_out` outcome; only fixtures with no recorded terminal outcome are re-dispatched on resume. Evidence MUST record, per fixture, the recorded outcome and the retained-artifact paths, and MUST distinguish a fixture that was explicitly `--retry`-ed (recording the prior outcome) from one that completed on first dispatch. Evidence MUST NOT claim `minimum_coverage_locked=true` unless every fixture row records a terminal `passed` outcome with its per-fixture baseline locked, exactly as in the predecessor gate.

Evidence MUST report the retention footprint (retained vs pruned per fixture) so the canonical-verification scratch reduction is auditable, and MUST surface any manifest-vs-disk drift rather than silently treating a drifted fixture as a clean pass.

#### Scenario: Queue-produced evidence equals monolithic evidence on the same inputs

- **WHEN** the canonical fixture set is run to completion via repeated `--run-next` and summarized with `--summary`
- **THEN** the recorded `outcome_distribution` and `minimum_coverage_locked` equal what the monolithic `--limit`-style path would produce on the same inputs
- **AND** the bucket definitions and lock gate are the predecessor's, reused without redefinition

#### Scenario: Resumed batch does not auto-retry recorded failures

- **WHEN** a batch is resumed after a crash and `--run-next` is invoked
- **THEN** only fixtures with no recorded terminal outcome are dispatched
- **AND** a fixture already recorded as `failed` or `timed_out` is left as-is unless an explicit `--retry` was issued, which the evidence records together with the prior outcome

#### Scenario: Evidence records retention footprint and surfaces drift

- **WHEN** queue-produced canonical evidence is compiled
- **THEN** it reports, per fixture, the retained artifact paths and which large arrays were pruned, so the scratch-footprint reduction is auditable
- **AND** any manifest row whose retained path is missing on disk is reported as a drift diagnostic, not counted as a clean pass

#### Scenario: Lock claim requires every fixture recorded passed

- **WHEN** at least one fixture row is not a terminal `passed` with its per-fixture baseline locked
- **THEN** the evidence records `minimum_coverage_locked=false`
- **AND** the evidence lists the blocking fixtures and their recorded bucket
