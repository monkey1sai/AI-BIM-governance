## ADDED Requirements

### Requirement: Demo observation tasks require current evidence

Demo observation tasks SHALL only be marked complete when current evidence exists for the claimed status. Historical evidence MAY be referenced for context, but task completion MUST identify whether the current run passed, failed, was blocked, was deferred, or was not observed.

#### Scenario: Task is marked complete after live observation

- **WHEN** a task marks a demo tier as observed
- **THEN** `tasks.md` or the verification report includes the current command or observation method, result status, timestamp, and evidence path or blocker details

#### Scenario: Historical evidence is reused as context

- **WHEN** a task references an older report or archived OpenSpec change
- **THEN** the task records it as historical context and still states whether the current tier was rerun or left as `not_observed`

#### Scenario: Blocker investigation is complete

- **WHEN** a blocker is classified for a runtime tier
- **THEN** the blocker-classification task MAY be marked complete, but the runtime pass task MUST remain incomplete unless live pass evidence exists

### Requirement: Demo observation checklist separates observation from fixes

The demo observation checklist SHALL distinguish evidence gathering from implementation fixes. A failed or blocked observation MUST produce a clear finding and next step instead of silently changing product behavior inside the observation task.

#### Scenario: Observation discovers a defect

- **WHEN** current demo observation finds a code, configuration, dependency, or runtime defect
- **THEN** the task records the finding, affected owner, evidence, and smallest next fix path
- **AND** the affected functional pass remains incomplete until the fix is implemented and re-observed

#### Scenario: Observation requires no product change

- **WHEN** all in-scope demo tiers either pass or have explicit blocker/deferred classifications
- **THEN** the observation change may be completed with documentation and evidence updates only
