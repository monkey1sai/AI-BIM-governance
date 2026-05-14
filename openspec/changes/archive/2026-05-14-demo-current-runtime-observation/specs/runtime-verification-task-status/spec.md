## ADDED Requirements

### Requirement: Demo observation tasks require current evidence

Demo observation tasks SHALL 只有在 claimed status 具備 current evidence 時才能標記完成。Historical evidence MAY 作為 context 引用，但 task completion MUST 識別 current run 是 passed、failed、blocked、deferred，或 was not observed。

#### Scenario: Task is marked complete after live observation

- **WHEN** task 將某個 demo tier 標記為 observed
- **THEN** `tasks.md` 或 verification report 包含 current command 或 observation method、result status、timestamp，以及 evidence path 或 blocker details

#### Scenario: Historical evidence is reused as context

- **WHEN** task 引用較舊的 report 或 archived OpenSpec change
- **THEN** task 將它記錄為 historical context，並仍需說明 current tier 是否已重新執行，或保留為 `not_observed`

#### Scenario: Blocker investigation is complete

- **WHEN** runtime tier 的 blocker 已完成分類
- **THEN** blocker-classification task MAY 標記完成，但 runtime pass task MUST 維持未完成，除非存在 live pass evidence

### Requirement: Demo observation checklist separates observation from fixes

Demo observation checklist SHALL 區分 evidence gathering 與 implementation fixes。Failed 或 blocked observation MUST 產生清楚 finding 與 next step，而不是在 observation task 內靜默改變 product behavior。

#### Scenario: Observation discovers a defect

- **WHEN** current demo observation 找到 code、configuration、dependency 或 runtime defect
- **THEN** task 記錄 finding、affected owner、evidence，以及 smallest next fix path
- **AND** affected functional pass 維持未完成，直到 fix 已實作並重新觀測

#### Scenario: Observation requires no product change

- **WHEN** 所有 in-scope demo tiers 都已通過，或已具備明確 blocker/deferred classifications
- **THEN** observation change 可以只用 documentation 與 evidence updates 完成
